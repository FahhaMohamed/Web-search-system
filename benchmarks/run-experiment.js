#!/usr/bin/env node
/**
 * Top-level orchestrator for the head-to-head benchmark experiment.
 *
 * Usage:
 *   node benchmarks/run-experiment.js                       # both architectures
 *   node benchmarks/run-experiment.js --arch new            # only new-arch
 *   node benchmarks/run-experiment.js --arch old            # only old-arch
 *   node benchmarks/run-experiment.js --sizes 100,1000      # custom sizes
 *
 * For each (architecture, size):
 *   - Bring up / restart the appropriate stack
 *   - Load the dataset of that size
 *   - Start a resource sampler
 *   - Fire all queries x repetitions, record latency
 *   - Stop the sampler, write resource CSV
 *
 * Outputs to benchmarks/results/:
 *   - new-<size>.csv             (per-query latency rows)
 *   - new-<size>-resources.csv   (sampled CPU% and memory MB)
 *   - old-<size>.csv             (same for old architecture)
 *   - old-<size>-resources.csv
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const axios = require('axios');

const { runBenchmark } = require('./harness/run-new');
const { runBenchmarkOld } = require('./harness/run-old');
const { startSampler } = require('./harness/resources');

const ROOT = path.join(__dirname, '..');
const BENCH = __dirname;
const RESULTS = path.join(BENCH, 'results');
const DATASETS = path.join(BENCH, 'datasets');
const QUERIES_PATH = path.join(BENCH, 'queries', 'text-queries.json');

const OLD_WORKTREE = path.join(ROOT, '..', 'namenode-worktree');

const DEFAULT_SIZES = [100, 1000, 10000, 100000];
const DEFAULT_REPS = 10;
const SAMPLE_INTERVAL_MS = 1000;

const SCHEMA = {
    text: ['title', 'description'],
    metadata: ['price', 'rating'],
    tags: ['category', 'brand'],
};

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { arch: 'both', sizes: DEFAULT_SIZES, reps: DEFAULT_REPS };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--arch' && args[i + 1]) opts.arch = args[++i];
        else if (args[i] === '--sizes' && args[i + 1]) opts.sizes = args[++i].split(',').map(Number);
        else if (args[i] === '--reps' && args[i + 1]) opts.reps = parseInt(args[++i], 10);
    }
    return opts;
}

function shell(cmd, cwd) {
    console.log(`  $ ${cmd}${cwd ? `  (cwd=${cwd})` : ''}`);
    execSync(cmd, { cwd, stdio: 'inherit' });
}

function shellQuiet(cmd, cwd) {
    return execSync(cmd, { cwd, encoding: 'utf-8' }).trim();
}

async function waitForContainerExited(name, retries = 60, intervalMs = 1000) {
    process.stdout.write(`  waiting for ${name} to exit`);
    for (let i = 0; i < retries; i++) {
        try {
            const status = execSync(`docker inspect -f "{{.State.Status}}" ${name}`, { encoding: 'utf-8' }).trim();
            if (status === 'exited') {
                process.stdout.write('  OK\n');
                return;
            }
        } catch (_) { /* container may not exist yet */ }
        process.stdout.write('.');
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`${name} did not exit within ${retries * intervalMs}ms`);
}

async function waitForHealthy(url, label, retries = 90, intervalMs = 2000) {
    process.stdout.write(`  waiting for ${label}`);
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios.get(url, { timeout: 2000 });
            if (res.status === 200) {
                process.stdout.write('  OK\n');
                return;
            }
        } catch (_) {
            /* not ready */
        }
        process.stdout.write('.');
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`${label} never came up at ${url}`);
}

function rowsToLatencyCsv(rows, size) {
    const header = 'size,query,repetition,latency_ms,result_count,status';
    const lines = rows.map(
        (r) =>
            `${size},${r.query},${r.repetition},${r.latencyMs.toFixed(3)},${r.resultCount},${r.status}`,
    );
    return [header, ...lines].join('\n') + '\n';
}

function samplesToResourcesCsv(samples, startTime) {
    const header = 'time_offset_ms,container,cpu_percent,mem_mb';
    const lines = [];
    for (const { time, samples: rows } of samples) {
        const offset = time - startTime;
        for (const s of rows) {
            lines.push(`${offset},${s.container},${s.cpuPercent.toFixed(3)},${s.memMb.toFixed(2)}`);
        }
    }
    return [header, ...lines].join('\n') + '\n';
}

function loadDocs(size) {
    return JSON.parse(fs.readFileSync(path.join(DATASETS, `docs-${size}.json`), 'utf-8'));
}

function clearDataDir() {
    const dataDir = path.join(ROOT, 'data');
    if (!fs.existsSync(dataDir)) return;
    for (const f of fs.readdirSync(dataDir)) {
        const full = path.join(dataDir, f);
        try { fs.rmSync(full, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    }
}

function loadQueries() {
    return JSON.parse(fs.readFileSync(QUERIES_PATH, 'utf-8'));
}

async function withSampler(fn) {
    const samples = [];
    const start = Date.now();
    const stop = startSampler({
        intervalMs: SAMPLE_INTERVAL_MS,
        onSample: (s) => samples.push(s),
    });
    try {
        const result = await fn();
        return { result, samples, start };
    } finally {
        stop();
    }
}

function appendIndexingCsv(arch, size, indexingMs) {
    fs.mkdirSync(RESULTS, { recursive: true });
    const p = path.join(RESULTS, 'indexing.csv');
    const header = 'arch,size,indexing_ms\n';
    if (!fs.existsSync(p)) fs.writeFileSync(p, header);
    fs.appendFileSync(p, `${arch},${size},${indexingMs.toFixed(3)}\n`);
}

function writeRunCsvs(arch, size, rows, samples, start) {
    fs.mkdirSync(RESULTS, { recursive: true });
    const latencyPath = path.join(RESULTS, `${arch}-${size}.csv`);
    const resourcesPath = path.join(RESULTS, `${arch}-${size}-resources.csv`);
    fs.writeFileSync(latencyPath, rowsToLatencyCsv(rows, size));
    fs.writeFileSync(resourcesPath, samplesToResourcesCsv(samples, start));
    return { latencyPath, resourcesPath };
}

// ---------- NEW ARCHITECTURE ----------

async function runNewArch(sizes, reps) {
    console.log('\n========== NEW ARCHITECTURE (3rd-Architecture) ==========');
    const { domain, queries } = loadQueries();

    for (const size of sizes) {
        console.log(`\n--- new-arch size=${size} ---`);
        console.log('  bringing stack down + back up to clear in-memory state...');
        try { shell('docker compose down --remove-orphans', ROOT); } catch (_) { /* may be already down */ }
        clearDataDir();
        shell('docker compose up -d', ROOT);
        await waitForHealthy('http://localhost:5000/health', 'schema-registry');
        await waitForHealthy('http://localhost:3000/api/health', 'gateway');

        const documents = loadDocs(size);
        console.log(`  running ${queries.length} queries x ${reps} reps over ${documents.length} docs`);

        const { result, samples, start } = await withSampler(() =>
            runBenchmark({
                schemaRegistryUrl: 'http://localhost:5000',
                gatewayUrl: 'http://localhost:3000',
                domain,
                schema: SCHEMA,
                documents,
                queries,
                repetitions: reps,
                batchSize: 300,
                onProgress: (e) => {
                    if (e.phase === 'index') process.stdout.write(`\r  indexing batch ${e.batch}/${e.total}`);
                },
            }),
        );
        process.stdout.write('\n');

        const { rows, indexingMs } = result;
        const { latencyPath, resourcesPath } = writeRunCsvs('new', size, rows, samples, start);
        appendIndexingCsv('new', size, indexingMs);
        const latSum = rows.reduce((s, r) => s + r.latencyMs, 0);
        console.log(`  wrote ${rows.length} latency rows -> ${path.basename(latencyPath)}`);
        console.log(`  wrote ${samples.length} resource ticks -> ${path.basename(resourcesPath)}`);
        console.log(`  indexing time = ${indexingMs.toFixed(1)} ms (${documents.length} docs)`);
        console.log(`  avg query latency = ${(latSum / rows.length).toFixed(2)} ms`);
    }

    console.log('\n  bringing new-arch down...');
    shell('docker compose down', ROOT);
}

// ---------- OLD ARCHITECTURE (via git worktree) ----------

function ensureOldWorktree() {
    if (!fs.existsSync(OLD_WORKTREE)) {
        console.log(`  creating git worktree for namenode branch...`);
        shell(`git worktree add "${OLD_WORKTREE}" namenode`, ROOT);
    } else {
        console.log(`  using existing worktree at ${OLD_WORKTREE}`);
    }
    patchOldCompose();
}

function patchOldCompose() {
    const composePath = path.join(OLD_WORKTREE, 'docker-compose.yml');
    let yml = fs.readFileSync(composePath, 'utf-8');
    if (!yml.includes('  crawler:')) return; // already patched
    yml = yml.replace(
        /  crawler:[\s\S]*?command: node crawler\.js\n\n  map:\n    build: \.\/map-node\n    depends_on:\n      - crawler/,
        '  map:\n    build: ./map-node\n    depends_on:\n      - namenode',
    );
    fs.writeFileSync(composePath, yml, 'utf-8');
    console.log('  patched old-arch docker-compose.yml: removed crawler stage');
}

function removeOldWorktree() {
    if (!fs.existsSync(OLD_WORKTREE)) return;
    try {
        shell(`docker compose down --remove-orphans`, OLD_WORKTREE);
    } catch (_) {
        /* stack may already be down */
    }
    shell(`git worktree remove "${OLD_WORKTREE}" --force`, ROOT);
}

function copySplitsIntoWorktree(size) {
    const src = path.join(DATASETS, `splits-${size}`);
    const dst = path.join(OLD_WORKTREE, 'dfs');
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(dst)) {
        try { fs.unlinkSync(path.join(dst, f)); } catch (_) {}
    }
    for (const f of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, f), path.join(dst, f));
    }
}

async function runOldArch(sizes, reps) {
    console.log('\n========== OLD ARCHITECTURE (namenode branch) ==========');
    ensureOldWorktree();
    const { queries } = loadQueries();

    for (const size of sizes) {
        console.log(`\n--- old-arch size=${size} ---`);

        console.log('  tearing down any prior old-arch stack...');
        try { shell('docker compose down --remove-orphans', OLD_WORKTREE); } catch (_) {}

        console.log('  starting cleaner + namenode (cleaner will wipe /dfs then exit)...');
        shell('docker compose up --build -d cleaner namenode', OLD_WORKTREE);
        await waitForHealthy('http://localhost:4000/success', 'namenode', 60);
        await waitForContainerExited('namenode-worktree-cleaner-1', 60);

        console.log(`  copying splits-${size}/ -> worktree/dfs/ (post-cleaner)`);
        copySplitsIntoWorktree(size);

        console.log('  registering splits with namenode (replacing crawler step)...');
        const splitFiles = fs.readdirSync(path.join(DATASETS, `splits-${size}`));
        for (const f of splitFiles) {
            await axios.post('http://localhost:4000/register', { fileName: f });
        }

        console.log('  starting map, reduce, search (no-deps so cleaner stays exited)...');
        const indexStartHr = process.hrtime.bigint();
        shell('docker compose up --build -d --no-deps map reduce search', OLD_WORKTREE);
        await waitForHealthy('http://localhost:3000/search?q=ping', 'old search-api', 300);
        const indexingMs = Number(process.hrtime.bigint() - indexStartHr) / 1_000_000;
        appendIndexingCsv('old', size, indexingMs);
        console.log(`  indexing time = ${indexingMs.toFixed(1)} ms (compose-up -> search-api healthy)`);

        console.log(`  running ${queries.length} queries x ${reps} reps`);
        const { result: rows, samples, start } = await withSampler(() =>
            runBenchmarkOld({
                searchApiUrl: 'http://localhost:3000',
                queries,
                repetitions: reps,
            }),
        );

        const { latencyPath, resourcesPath } = writeRunCsvs('old', size, rows, samples, start);
        const latSum = rows.reduce((s, r) => s + r.latencyMs, 0);
        console.log(`  wrote ${rows.length} latency rows -> ${path.basename(latencyPath)}`);
        console.log(`  wrote ${samples.length} resource ticks -> ${path.basename(resourcesPath)}`);
        console.log(`  avg query latency = ${(latSum / rows.length).toFixed(2)} ms`);

        console.log('  bringing old-arch down...');
        shell('docker compose down --remove-orphans', OLD_WORKTREE);
    }

    console.log('\n  removing git worktree...');
    removeOldWorktree();
}

// ---------- MAIN ----------

async function main() {
    const { arch, sizes, reps } = parseArgs();
    console.log(`Benchmark plan: arch=${arch}  sizes=[${sizes.join(', ')}]  reps=${reps}`);
    fs.mkdirSync(RESULTS, { recursive: true });

    const t0 = Date.now();
    if (arch === 'new' || arch === 'both') await runNewArch(sizes, reps);
    if (arch === 'old' || arch === 'both') await runOldArch(sizes, reps);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nExperiment complete. Total elapsed: ${elapsed}s`);
}

main().catch((err) => {
    console.error('\nExperiment crashed:', err.message);
    if (err.response) console.error('response:', err.response.status, err.response.data);
    process.exit(1);
});
