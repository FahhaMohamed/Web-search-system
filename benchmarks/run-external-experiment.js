#!/usr/bin/env node
/**
 * External-benchmark orchestrator.
 *
 * Runs the full (engine × domain × size) matrix or any selected subset
 * specified via CLI flags. Phase 1 wires only `elastic`. Phases 2 and 3
 * extend the ENGINES dispatch table with meili / ours.
 *
 * Usage:
 *   node benchmarks/run-external-experiment.js                            # full matrix
 *   node benchmarks/run-external-experiment.js --engine elastic          # one engine
 *   node benchmarks/run-external-experiment.js --domain articles
 *   node benchmarks/run-external-experiment.js --size 1000
 *   node benchmarks/run-external-experiment.js --engine elastic --domain papers --size 10000
 *   node benchmarks/run-external-experiment.js --reps 5
 *   node benchmarks/run-external-experiment.js --no-teardown             # leave the index up
 *
 * Outputs to benchmarks/results/:
 *   <engine>-<domain>-<size>.csv   — per-query latency rows
 *   summary.csv                     — one row per cell (engine, domain, size,
 *                                     setup_ms, indexing_ms, etc.)
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const elasticRunner = require('./harness/run-elastic');
const meiliRunner = require('./harness/run-meili');
const loadWikipedia = require('./loaders/load-wikipedia');
const loadArxiv = require('./loaders/load-arxiv');
const loadOFF = require('./loaders/load-openfoodfacts');

const BENCH = __dirname;
const RESULTS = path.join(BENCH, 'results');
const SETUP = path.join(BENCH, 'setup');
const QUERIES = path.join(BENCH, 'queries');

const ENGINES = {
    elastic: {
        healthUrl: 'http://localhost:9200',
        configFile: (domain) => path.join(SETUP, `elastic-mapping-${domain}.json`),
        setup: (args) => elasticRunner.setupElastic({ domain: args.domain, mapping: args.config }),
        index: (args) => elasticRunner.indexElastic(args),
        search: (args) => elasticRunner.runQueriesElastic(args),
        teardown: (args) => elasticRunner.teardownElastic(args),
    },
    meili: {
        healthUrl: 'http://localhost:7700/health',
        configFile: (domain) => path.join(SETUP, `meili-settings-${domain}.json`),
        // Meili's primary-key character set is [a-zA-Z0-9_-]. arXiv IDs like
        // `ax-2606.27377` are accepted by Elastic but rejected by Meili.
        // We normalize on the way in so the same dataset is comparable.
        prepareDocs: (docs) => {
            for (const d of docs) {
                if (typeof d.id === 'string' && d.id.indexOf('.') !== -1) {
                    d.id = d.id.replace(/\./g, '_');
                }
            }
        },
        setup: (args) => meiliRunner.setupMeili({ domain: args.domain, settings: args.config }),
        index: (args) => meiliRunner.indexMeili(args),
        search: (args) => meiliRunner.runQueriesMeili(args),
        teardown: (args) => meiliRunner.teardownMeili(args),
    },
    // ours added in Phase 3
};

const LOADERS = {
    articles: { module: loadWikipedia, fn: 'loadWikipedia' },
    papers: { module: loadArxiv, fn: 'loadArxiv' },
    products: { module: loadOFF, fn: 'loadOpenFoodFacts' },
};

const DEFAULT_SIZES = [100, 1000, 10000, 100000];
const DEFAULT_DOMAINS = ['articles', 'papers', 'products'];
const DEFAULT_REPS = 10;

function parseList(val, allowed) {
    if (!val || val === 'all') return allowed.slice();
    const parts = String(val)
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    for (const p of parts) {
        if (!allowed.map(String).includes(String(p))) {
            throw new Error(`unknown value "${p}" — allowed: ${allowed.join(', ')}`);
        }
    }
    return parts;
}

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        engines: Object.keys(ENGINES),
        domains: DEFAULT_DOMAINS,
        sizes: DEFAULT_SIZES,
        reps: DEFAULT_REPS,
        teardown: true,
    };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const next = args[i + 1];
        if (a === '--engine' && next) {
            opts.engines = parseList(next, Object.keys(ENGINES));
            i++;
        } else if (a === '--domain' && next) {
            opts.domains = parseList(next, DEFAULT_DOMAINS);
            i++;
        } else if (a === '--size' && next) {
            opts.sizes = parseList(next, DEFAULT_SIZES.map(String)).map(Number);
            i++;
        } else if (a === '--reps' && next) {
            opts.reps = parseInt(next, 10);
            i++;
        } else if (a === '--no-teardown') {
            opts.teardown = false;
        }
    }
    return opts;
}

async function waitForHealthy(url, label) {
    const retries = 60;
    const intervalMs = 2000;
    process.stdout.write(`  waiting for ${label}`);
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios.get(url, { timeout: 2000 });
            if (res.status === 200) {
                process.stdout.write(`  OK\n`);
                return;
            }
        } catch (_e) {
            /* keep trying */
        }
        process.stdout.write('.');
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`${label} did not come up at ${url}`);
}

/**
 * Mutate docs in place to remove oversized array entries (>500 chars) and
 * truncate oversized strings. Defensive cleanup for cached data that may
 * predate a loader fix. Real tag values are well under 200 chars; anything
 * larger is corrupt parsing output (e.g., entire author-block XML swept
 * into one entry by a buggy regex).
 */
const MAX_TAG_LEN = 500;
const MAX_TEXT_LEN = 32000; // Elasticsearch keyword field max is 32766

function sanitizeDocs(docs) {
    for (const d of docs) {
        for (const k of Object.keys(d)) {
            const v = d[k];
            if (Array.isArray(v)) {
                d[k] = v.filter((x) => typeof x === 'string' && x.length <= MAX_TAG_LEN);
            } else if (typeof v === 'string' && v.length > MAX_TEXT_LEN) {
                d[k] = v.slice(0, MAX_TEXT_LEN);
            }
        }
    }
}

function rowsToCsv(rows, engine, domain, size) {
    const header = 'engine,domain,size,query,query_type,repetition,latency_ms,result_count,status';
    const lines = rows.map(
        (r) =>
            `${engine},${domain},${size},"${String(r.query).replace(/"/g, '""')}",${r.queryType},${r.repetition},${r.latencyMs.toFixed(3)},${r.resultCount},${r.status}`,
    );
    return [header, ...lines].join('\n') + '\n';
}

function appendSummaryRow(row) {
    fs.mkdirSync(RESULTS, { recursive: true });
    const p = path.join(RESULTS, 'summary.csv');
    const header = 'engine,domain,size,setup_ms,indexing_ms,indexed,query_rows,error_rows,timestamp\n';
    if (!fs.existsSync(p)) fs.writeFileSync(p, header);
    const line = `${row.engine},${row.domain},${row.size},${row.setupMs.toFixed(1)},${row.indexingMs.toFixed(1)},${row.indexed},${row.queryRows},${row.errorRows},${row.timestamp}\n`;
    fs.appendFileSync(p, line);
}

function loadCanonicalQueries(domain) {
    const p = path.join(QUERIES, `canonical-${domain}.json`);
    const blob = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return blob.queries;
}

async function runCell({ engine, domain, size, reps, teardown }) {
    const engCfg = ENGINES[engine];
    if (!engCfg) throw new Error(`unknown engine: ${engine}`);
    const loaderCfg = LOADERS[domain];
    if (!loaderCfg) throw new Error(`unknown domain: ${domain}`);

    console.log(`\n=== ${engine} × ${domain} × ${size} ===`);

    // 1. Wait for engine health
    await waitForHealthy(engCfg.healthUrl, `${engine} at ${engCfg.healthUrl}`);

    // 2. Load docs from cache
    process.stdout.write(`  loading ${size} ${domain} docs from cache...`);
    const docs = await loaderCfg.module[loaderCfg.fn]({ size });
    sanitizeDocs(docs);
    if (typeof engCfg.prepareDocs === 'function') {
        engCfg.prepareDocs(docs);
    }
    process.stdout.write(` OK (${docs.length} docs)\n`);

    // 3. Load queries + per-engine config (mapping for Elastic, settings for Meili, etc.)
    const queries = loadCanonicalQueries(domain);
    const config = JSON.parse(fs.readFileSync(engCfg.configFile(domain), 'utf-8'));

    // 4. SETUP
    process.stdout.write(`  setup...`);
    const setupResult = await engCfg.setup({ domain, config });
    process.stdout.write(` ${setupResult.setupMs.toFixed(0)}ms\n`);

    // 5. INDEX
    process.stdout.write(`  indexing ${docs.length} docs...`);
    const indexResult = await engCfg.index({
        domain,
        docs,
        batchSize: 500,
        onProgress: (e) => {
            if (e.phase === 'bulk') process.stdout.write(`\r  indexing... ${e.indexed}/${e.total}`);
        },
    });
    process.stdout.write(`\r  indexing... ${indexResult.indexingMs.toFixed(0)}ms (${indexResult.indexed} docs)\n`);

    // 6. SEARCH
    process.stdout.write(`  running ${queries.length} queries × ${reps} reps...`);
    const searchStart = Date.now();
    const { rows } = await engCfg.search({ domain, queries, reps });
    const searchSec = ((Date.now() - searchStart) / 1000).toFixed(1);
    const errorRows = rows.filter((r) => r.status !== 'ok').length;
    process.stdout.write(` ${rows.length} rows in ${searchSec}s (${errorRows} errors)\n`);

    // 7. Write CSV
    fs.mkdirSync(RESULTS, { recursive: true });
    const csvPath = path.join(RESULTS, `${engine}-${domain}-${size}.csv`);
    fs.writeFileSync(csvPath, rowsToCsv(rows, engine, domain, size));
    console.log(`  wrote ${csvPath}`);

    // 8. Summary
    appendSummaryRow({
        engine,
        domain,
        size,
        setupMs: setupResult.setupMs,
        indexingMs: indexResult.indexingMs,
        indexed: indexResult.indexed,
        queryRows: rows.length,
        errorRows,
        timestamp: new Date().toISOString(),
    });

    // 9. Teardown
    if (teardown) {
        await engCfg.teardown({ domain });
        console.log(`  teardown ok`);
    } else {
        console.log(`  (teardown skipped)`);
    }
}

async function main() {
    const opts = parseArgs();
    console.log('Plan:');
    console.log('  engines:', opts.engines.join(', '));
    console.log('  domains:', opts.domains.join(', '));
    console.log('  sizes:  ', opts.sizes.join(', '));
    console.log('  reps:   ', opts.reps);
    console.log('  teardown:', opts.teardown);

    const t0 = Date.now();
    let pass = 0;
    let fail = 0;
    const failures = [];

    for (const engine of opts.engines) {
        for (const domain of opts.domains) {
            for (const size of opts.sizes) {
                try {
                    await runCell({
                        engine,
                        domain,
                        size,
                        reps: opts.reps,
                        teardown: opts.teardown,
                    });
                    pass++;
                } catch (err) {
                    fail++;
                    failures.push({ engine, domain, size, error: err.message });
                    console.error(`  FAILED: ${err.message}`);
                }
            }
        }
    }

    const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nDone. ${pass} pass / ${fail} fail in ${totalSec}s`);
    if (failures.length > 0) {
        console.log('Failures:');
        for (const f of failures) {
            console.log(`  ${f.engine} × ${f.domain} × ${f.size}: ${f.error}`);
        }
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('Experiment crashed:', err.message);
    process.exit(1);
});
