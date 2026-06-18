#!/usr/bin/env node
/**
 * CLI for the new-architecture benchmark harness.
 *
 * Usage:
 *   node benchmarks/harness/run-new-cli.js --size 100
 *   node benchmarks/harness/run-new-cli.js --size 10000 --repetitions 10
 *
 * Reads:  benchmarks/datasets/docs-<size>.json + benchmarks/queries/text-queries.json
 * Writes: benchmarks/results/new-<size>.csv
 *
 * Requires the 3rd-Architecture docker stack to be up:
 *   docker compose up --build -d
 */

const fs = require('fs');
const path = require('path');
const { runBenchmark } = require('./run-new');

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3000';
const SCHEMA_REGISTRY = process.env.SCHEMA_REGISTRY_URL || 'http://localhost:5000';
const DEFAULT_REPS = 10;

const ROOT = path.join(__dirname, '..');
const QUERIES_PATH = path.join(ROOT, 'queries', 'text-queries.json');

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { size: null, repetitions: DEFAULT_REPS, batchSize: 300 };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--size' && args[i + 1]) opts.size = parseInt(args[++i], 10);
        else if (args[i] === '--repetitions' && args[i + 1]) opts.repetitions = parseInt(args[++i], 10);
        else if (args[i] === '--batch-size' && args[i + 1]) opts.batchSize = parseInt(args[++i], 10);
    }
    if (!opts.size) {
        console.error('Usage: run-new-cli.js --size <100|1000|10000|100000> [--repetitions N]');
        process.exit(1);
    }
    return opts;
}

function rowsToCsv(rows, size) {
    const header = 'size,query,query_type,repetition,latency_ms,result_count,status';
    const lines = rows.map(
        (r) =>
            `${size},"${r.query}",${r.queryType},${r.repetition},${r.latencyMs.toFixed(3)},${r.resultCount},${r.status}`,
    );
    return [header, ...lines].join('\n') + '\n';
}

async function main() {
    const { size, repetitions, batchSize } = parseArgs();

    const docsPath = path.join(ROOT, 'datasets', `docs-${size}.json`);
    if (!fs.existsSync(docsPath)) {
        console.error(`Dataset not found at ${docsPath}. Run generate-dataset-cli.js first.`);
        process.exit(1);
    }
    const documents = JSON.parse(fs.readFileSync(docsPath, 'utf-8'));
    const queriesFile = JSON.parse(fs.readFileSync(QUERIES_PATH, 'utf-8'));
    const { domain, queries } = queriesFile;
    const schema = { text: ['title', 'description'], metadata: ['price', 'rating'], tags: ['category', 'brand'] };

    console.log(`\nNEW-arch benchmark | size=${size} | queries=${queries.length} | reps=${repetitions}`);
    console.log(`gateway=${GATEWAY} | schema-registry=${SCHEMA_REGISTRY}\n`);

    const t0 = Date.now();
    const { rows } = await runBenchmark({
        schemaRegistryUrl: SCHEMA_REGISTRY,
        gatewayUrl: GATEWAY,
        domain,
        schema,
        documents,
        queries,
        repetitions,
        batchSize,
        onProgress: (e) => {
            if (e.phase === 'index') process.stdout.write(`\rindexing batch ${e.batch}/${e.total}`);
            if (e.phase === 'schema-registered') process.stdout.write('schema OK\n');
        },
    });
    process.stdout.write('\n');

    const resultsDir = path.join(ROOT, 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const outPath = path.join(resultsDir, `new-${size}.csv`);
    fs.writeFileSync(outPath, rowsToCsv(rows, size));

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Wrote ${rows.length} rows to ${outPath}  (elapsed ${elapsed}s)`);
}

main().catch((err) => {
    console.error('\nBenchmark crashed:', err.message);
    if (err.response) console.error('response:', err.response.status, err.response.data);
    process.exit(1);
});
