#!/usr/bin/env node
/**
 * Concurrent-QPS benchmark.
 *
 * Fires N parallel virtual clients at each engine for a fixed duration
 * and records latency percentiles + sustained throughput. Different
 * axis from the per-query latency bench (which is single-client
 * sequential) — this one exposes concurrency limits.
 *
 * For each engine × concurrency:
 *   1. Setup: bring up if needed, register schema/mapping, index N docs
 *   2. Warm-up: 3 seconds of ignored traffic (fills caches, JIT warms)
 *   3. Measure: fire queries for `duration` seconds
 *   4. Aggregate: QPS = total-completed / duration; latency p50/p95/p99
 *
 * Each virtual client picks a random query from the canonical set,
 * fires it, records latency, loops until the deadline. Same query
 * set + same random sequence across all engines for fairness.
 *
 * Usage:
 *   node benchmarks/run-concurrent-qps.js
 *   node benchmarks/run-concurrent-qps.js --engine ours --concurrency 10,50,100
 *   node benchmarks/run-concurrent-qps.js --duration 30 --size 10000 --domain articles
 *
 * Output: benchmarks/results/qps-summary.csv (appended)
 *   engine,concurrency,duration_s,size,domain,qps,p50,p95,p99,total,errors,timestamp
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const http = require('http');
const { execSync } = require('child_process');

const elasticRunner = require('./harness/run-elastic');
const opensearchRunner = require('./harness/run-opensearch');
const solrRunner = require('./harness/run-solr');
const oursRunner = require('./harness/run-ours');
const loadWikipedia = require('./loaders/load-wikipedia');
const loadArxiv = require('./loaders/load-arxiv');
const loadOFF = require('./loaders/load-openfoodfacts');
const { toElastic, toOurs, toSolr, toOpenSearch } = require('./queries/translate');

const BENCH = __dirname;
const RESULTS = path.join(BENCH, 'results');
const SETUP = path.join(BENCH, 'setup');
const QUERIES = path.join(BENCH, 'queries');

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 512 });

const LOADERS = {
    articles: { module: loadWikipedia, fn: 'loadWikipedia' },
    papers: { module: loadArxiv, fn: 'loadArxiv' },
    products: { module: loadOFF, fn: 'loadOpenFoodFacts' },
};

const ENGINES = {
    elastic: {
        healthUrl: 'http://localhost:9200',
        setup: async ({ domain, size }) => {
            const mapping = JSON.parse(fs.readFileSync(path.join(SETUP, `elastic-mapping-${domain}.json`), 'utf8'));
            await elasticRunner.setupElastic({ domain, mapping });
            const docs = await loadDocs(domain, size);
            await elasticRunner.indexElastic({ domain, docs, batchSize: 500 });
        },
        fireOne: async (domain, canonical) => {
            const body = toElastic(canonical, domain);
            const res = await axios.post(`http://localhost:9200/${domain}/_search`, body, {
                timeout: 10000,
                headers: { 'Content-Type': 'application/json' },
                httpAgent,
            });
            return (res.data && res.data.hits && res.data.hits.hits && res.data.hits.hits.length) || 0;
        },
    },
    opensearch: {
        healthUrl: 'http://localhost:9201',
        setup: async ({ domain, size }) => {
            const mapping = JSON.parse(fs.readFileSync(path.join(SETUP, `opensearch-mapping-${domain}.json`), 'utf8'));
            await opensearchRunner.setupOpenSearch({ domain, mapping });
            const docs = await loadDocs(domain, size);
            await opensearchRunner.indexOpenSearch({ domain, docs, batchSize: 500 });
        },
        fireOne: async (domain, canonical) => {
            const body = toOpenSearch(canonical, domain);
            const res = await axios.post(`http://localhost:9201/${domain}/_search`, body, {
                timeout: 10000,
                headers: { 'Content-Type': 'application/json' },
                httpAgent,
            });
            return (res.data && res.data.hits && res.data.hits.hits && res.data.hits.hits.length) || 0;
        },
    },
    solr: {
        healthUrl: 'http://localhost:8983/solr/admin/info/system',
        setup: async ({ domain, size }) => {
            await solrRunner.setupSolr({ domain });
            const docs = await loadDocs(domain, size);
            await solrRunner.indexSolr({ domain, docs, batchSize: 500 });
        },
        fireOne: async (domain, canonical) => {
            const params = toSolr(canonical, domain);
            const res = await axios.get(`http://localhost:8983/solr/${domain}/select`, {
                params,
                timeout: 10000,
                httpAgent,
            });
            return (res.data && res.data.response && res.data.response.docs && res.data.response.docs.length) || 0;
        },
    },
    ours: {
        healthUrl: 'http://localhost:5000/health',
        prepareCell: async () => {
            const wtPath = process.env.OURS_WORKTREE || path.resolve(BENCH, '..', '..', 'ours-worktree');
            const dataDir = path.join(wtPath, 'data');
            try { execSync('docker compose down --remove-orphans', { cwd: wtPath, stdio: 'pipe' }); } catch (_e) {}
            if (fs.existsSync(dataDir)) {
                for (const f of fs.readdirSync(dataDir)) {
                    try { fs.rmSync(path.join(dataDir, f), { recursive: true, force: true }); } catch (_e) {}
                }
            }
            execSync('docker compose up -d', { cwd: wtPath, stdio: 'pipe' });
        },
        setup: async ({ domain, size }) => {
            const schema = JSON.parse(fs.readFileSync(path.join(SETUP, `ours-schema-${domain}.json`), 'utf8'));
            await oursRunner.setupOurs({ domain, schema });
            let docs = await loadDocs(domain, size);
            // slugify tag values (matches main bench harness — see prepareDocs there)
            const slugify = (v) => String(v).trim().toLowerCase().replace(/\s+/g, '-');
            for (const d of docs) {
                for (const k of Object.keys(d)) {
                    if (Array.isArray(d[k])) d[k] = d[k].map((x) => (typeof x === 'string' ? slugify(x) : x));
                }
            }
            await oursRunner.indexOurs({ domain, docs, batchSize: 500 });
        },
        fireOne: async (domain, canonical) => {
            const body = toOurs(canonical, domain);
            const res = await axios.post('http://localhost:3000/api/search', body, {
                timeout: 10000,
                headers: { 'Content-Type': 'application/json' },
                httpAgent,
            });
            return (res.data && res.data.results && res.data.results.length) || 0;
        },
    },
};

async function loadDocs(domain, size) {
    const loaderCfg = LOADERS[domain];
    return await loaderCfg.module[loaderCfg.fn]({ size });
}

async function waitForHealthy(url, label) {
    const retries = 60;
    process.stdout.write(`  waiting for ${label}`);
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios.get(url, { timeout: 2000 });
            if (res.status === 200) {
                process.stdout.write(`  OK\n`);
                return;
            }
        } catch (_e) { /* keep trying */ }
        process.stdout.write('.');
        await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`${label} did not come up at ${url}`);
}

function loadCanonicalQueries(domain) {
    const p = path.join(QUERIES, `canonical-${domain}.json`);
    return JSON.parse(fs.readFileSync(p, 'utf-8')).queries;
}

function pct(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/**
 * Fire queries at `concurrency` virtual clients for `durationMs`.
 * Each client picks a random canonical query, fires it, records latency,
 * loops until the deadline. Returns aggregate stats.
 */
async function runQPS({ engine, domain, concurrency, durationMs, record }) {
    const cfg = ENGINES[engine];
    const queries = loadCanonicalQueries(domain);
    const deadline = Date.now() + durationMs;
    const latencies = [];
    let completed = 0;
    let errors = 0;

    const workerFn = async () => {
        while (Date.now() < deadline) {
            const q = queries[Math.floor(Math.random() * queries.length)];
            const start = process.hrtime.bigint();
            try {
                await cfg.fireOne(domain, q);
                const ms = Number(process.hrtime.bigint() - start) / 1e6;
                if (record) {
                    latencies.push(ms);
                    completed++;
                }
            } catch (_err) {
                if (record) errors++;
            }
        }
    };

    const workers = [];
    for (let i = 0; i < concurrency; i++) workers.push(workerFn());
    await Promise.all(workers);

    const durationS = durationMs / 1000;
    return {
        qps: completed / durationS,
        total: completed,
        errors,
        p50: pct(latencies, 0.5),
        p95: pct(latencies, 0.95),
        p99: pct(latencies, 0.99),
        mean: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
    };
}

function appendSummary(row) {
    fs.mkdirSync(RESULTS, { recursive: true });
    const p = path.join(RESULTS, 'qps-summary.csv');
    const header = 'engine,concurrency,duration_s,size,domain,qps,p50,p95,p99,mean,total,errors,timestamp\n';
    if (!fs.existsSync(p)) fs.writeFileSync(p, header);
    const line = `${row.engine},${row.concurrency},${row.durationS},${row.size},${row.domain},${row.qps.toFixed(1)},${row.p50.toFixed(2)},${row.p95.toFixed(2)},${row.p99.toFixed(2)},${row.mean.toFixed(2)},${row.total},${row.errors},${row.timestamp}\n`;
    fs.appendFileSync(p, line);
}

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        engines: ['elastic', 'opensearch', 'solr', 'ours'],
        concurrencies: [10, 50, 100],
        durationSec: 20,
        size: 10000,
        domain: 'articles',
    };
    for (let i = 0; i < args.length; i++) {
        const a = args[i], next = args[i + 1];
        if (a === '--engine' && next) { opts.engines = next.split(',').map((s) => s.trim()); i++; }
        else if (a === '--concurrency' && next) { opts.concurrencies = next.split(',').map((s) => parseInt(s.trim(), 10)); i++; }
        else if (a === '--duration' && next) { opts.durationSec = parseInt(next, 10); i++; }
        else if (a === '--size' && next) { opts.size = parseInt(next, 10); i++; }
        else if (a === '--domain' && next) { opts.domain = next; i++; }
    }
    return opts;
}

(async () => {
    const opts = parseArgs();
    console.log('Concurrent-QPS benchmark');
    console.log(`  engines:      ${opts.engines.join(', ')}`);
    console.log(`  concurrency:  ${opts.concurrencies.join(', ')}`);
    console.log(`  duration:     ${opts.durationSec}s per level`);
    console.log(`  domain/size:  ${opts.domain} × ${opts.size}`);

    for (const engine of opts.engines) {
        const cfg = ENGINES[engine];
        if (!cfg) { console.error(`unknown engine: ${engine}`); continue; }

        console.log(`\n=== ${engine} ===`);

        // Reset (ours only — Lucene engines stay up across levels)
        if (typeof cfg.prepareCell === 'function') {
            process.stdout.write(`  reset...`);
            const t0 = Date.now();
            await cfg.prepareCell();
            process.stdout.write(` ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
        }

        await waitForHealthy(cfg.healthUrl, `${engine} at ${cfg.healthUrl}`);

        // Setup + index once. All concurrency levels use the same indexed data.
        process.stdout.write(`  setup + indexing ${opts.size} ${opts.domain}...`);
        const setupStart = Date.now();
        await cfg.setup({ domain: opts.domain, size: opts.size });
        process.stdout.write(` ${((Date.now() - setupStart) / 1000).toFixed(1)}s\n`);

        for (const concurrency of opts.concurrencies) {
            process.stdout.write(`  c=${concurrency}: warmup 3s...`);
            await runQPS({ engine, domain: opts.domain, concurrency, durationMs: 3000, record: false });
            process.stdout.write(` measuring ${opts.durationSec}s...`);
            const stats = await runQPS({
                engine, domain: opts.domain, concurrency,
                durationMs: opts.durationSec * 1000, record: true,
            });
            process.stdout.write(` QPS=${stats.qps.toFixed(0)} p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms p99=${stats.p99.toFixed(1)}ms errors=${stats.errors}\n`);
            appendSummary({
                engine, concurrency, durationS: opts.durationSec, size: opts.size, domain: opts.domain,
                ...stats, timestamp: new Date().toISOString(),
            });
        }
    }

    console.log('\nDone. Results in benchmarks/results/qps-summary.csv');
})().catch((err) => {
    console.error(`FATAL: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
});
