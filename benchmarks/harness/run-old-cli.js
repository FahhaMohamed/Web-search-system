#!/usr/bin/env node
/**
 * CLI for the old-architecture (namenode) benchmark harness.
 *
 * Usage:
 *   node benchmarks/harness/run-old-cli.js --size 100
 *   node benchmarks/harness/run-old-cli.js --size 10000 --repetitions 10
 *
 * Reads:  benchmarks/queries/text-queries.json
 * Writes: benchmarks/results/old-<size>.csv
 *
 * PREREQUISITES (handled by Step 7 orchestrator, not this CLI):
 *   1. Splits from benchmarks/datasets/splits-<size>/ have been copied
 *      into namenode branch's dfs/ folder
 *   2. namenode docker stack is up with index.json built
 *   3. search-api is listening on http://localhost:3000
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { runBenchmarkOld } = require('./run-old');

const SEARCH_API = process.env.OLD_SEARCH_API_URL || 'http://localhost:3000';
const DEFAULT_REPS = 10;

const ROOT = path.join(__dirname, '..');
const QUERIES_PATH = path.join(ROOT, 'queries', 'text-queries.json');

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { size: null, repetitions: DEFAULT_REPS };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--size' && args[i + 1]) opts.size = parseInt(args[++i], 10);
        else if (args[i] === '--repetitions' && args[i + 1]) opts.repetitions = parseInt(args[++i], 10);
    }
    if (!opts.size) {
        console.error('Usage: run-old-cli.js --size <100|1000|10000|100000> [--repetitions N]');
        process.exit(1);
    }
    return opts;
}

async function waitForSearchApi(url, retries = 60) {
    for (let i = 0; i < retries; i++) {
        try {
            await axios.get(`${url}/search`, { params: { q: 'ping' }, timeout: 2000 });
            return true;
        } catch (_) {
            /* not ready */
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`search-api at ${url} never came up`);
}

function rowsToCsv(rows, size) {
    const header = 'size,query,repetition,latency_ms,result_count,status';
    const lines = rows.map(
        (r) =>
            `${size},${r.query},${r.repetition},${r.latencyMs.toFixed(3)},${r.resultCount},${r.status}`,
    );
    return [header, ...lines].join('\n') + '\n';
}

async function main() {
    const { size, repetitions } = parseArgs();

    const queriesFile = JSON.parse(fs.readFileSync(QUERIES_PATH, 'utf-8'));
    const { queries } = queriesFile;

    console.log(`\nOLD-arch (namenode) benchmark | size=${size} | queries=${queries.length} | reps=${repetitions}`);
    console.log(`search-api=${SEARCH_API}\n`);

    console.log('Waiting for search-api...');
    await waitForSearchApi(SEARCH_API);
    console.log('search-api ready.\n');

    const t0 = Date.now();
    const rows = await runBenchmarkOld({
        searchApiUrl: SEARCH_API,
        queries,
        repetitions,
        onProgress: (e) => {
            if (e.phase === 'query' && e.repetition === 1) process.stdout.write(`${e.query} `);
        },
    });
    process.stdout.write('\n');

    const resultsDir = path.join(ROOT, 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const outPath = path.join(resultsDir, `old-${size}.csv`);
    fs.writeFileSync(outPath, rowsToCsv(rows, size));

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nWrote ${rows.length} rows to ${outPath}  (elapsed ${elapsed}s)`);
}

main().catch((err) => {
    console.error('\nBenchmark crashed:', err.message);
    if (err.response) console.error('response:', err.response.status, err.response.data);
    process.exit(1);
});
