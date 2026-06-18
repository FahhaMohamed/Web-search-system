#!/usr/bin/env node
/**
 * CLI for the external (Open Library) benchmark dataset.
 *
 * Usage:
 *   node benchmarks/generate-external-cli.js              (all four sizes — needs cache or network)
 *   node benchmarks/generate-external-cli.js --size 1000  (one size)
 *   node benchmarks/generate-external-cli.js --fetch-only (just populate the cache, do not write per-size files)
 *
 * Writes to benchmarks/datasets/:
 *   docs-<size>.json         (for Optimized Architecture POST /api/index)
 *   splits-<size>/splitN.txt (for Previous Architecture /dfs/)
 *
 * The four sizes read four non-overlapping windows of the cache so a doc
 * that appears in the 100-doc dataset never appears in the 1k/10k/100k.
 */

const fs = require('fs');
const path = require('path');
const {
    SUPPORTED_SIZES,
    TOTAL_RECORDS,
    fetchAndCache,
    sliceForSize,
    DEFAULT_CACHE_FILE,
} = require('./load-external-dataset');
const { toOldArchTextSplits } = require('./generate-dataset');

const OUT_DIR = path.join(__dirname, 'datasets');

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { size: null, fetchOnly: false };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--size' && args[i + 1]) opts.size = parseInt(args[++i], 10);
        else if (args[i] === '--fetch-only') opts.fetchOnly = true;
    }
    return opts;
}

function writeOneSize(cache, size) {
    const docs = sliceForSize(cache, size);

    const jsonPath = path.join(OUT_DIR, `docs-${size}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(docs, null, 2));
    const jsonBytes = fs.statSync(jsonPath).size;

    const splitsDir = path.join(OUT_DIR, `splits-${size}`);
    fs.mkdirSync(splitsDir, { recursive: true });
    const splits = toOldArchTextSplits({ docs }, 3);
    let textBytes = 0;
    for (const [name, content] of Object.entries(splits)) {
        const p = path.join(splitsDir, name);
        fs.writeFileSync(p, content);
        textBytes += fs.statSync(p).size;
    }

    console.log(
        `size=${String(size).padStart(7)}  json=${(jsonBytes / 1024).toFixed(1)} KB  splits=${(textBytes / 1024).toFixed(1)} KB`,
    );
}

function neededForSize(size) {
    if (!size) return TOTAL_RECORDS;
    const idx = SUPPORTED_SIZES.indexOf(size);
    if (idx === -1) return TOTAL_RECORDS;
    let cursor = 0;
    for (let i = 0; i <= idx; i++) cursor += SUPPORTED_SIZES[i];
    return cursor;
}

async function main() {
    const opts = parseArgs();
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const needed = opts.fetchOnly ? TOTAL_RECORDS : neededForSize(opts.size);
    console.log(`Cache file: ${DEFAULT_CACHE_FILE}`);
    console.log(`Target records (for this run): ${needed}\n`);

    let lastProgressPage = 0;
    const cache = await fetchAndCache({
        targetCount: needed,
        onProgress: (e) => {
            if (e.phase === 'cache-hit') {
                console.log(`cache hit: ${e.cached} records already on disk`);
            } else if (e.phase === 'page' && e.page !== lastProgressPage) {
                lastProgressPage = e.page;
                process.stdout.write(
                    `\rfetching... page=${e.page} cached=${e.cached}/${e.target}    `,
                );
            }
        },
    });
    process.stdout.write('\n');

    if (cache.length < needed) {
        console.error(
            `\nWARNING: only ${cache.length} records fetched (needed ${needed}).`,
        );
    }

    if (opts.fetchOnly) {
        console.log(`\nFetch-only complete. Cache has ${cache.length} records.`);
        return;
    }

    const targets = opts.size ? [opts.size] : SUPPORTED_SIZES;
    console.log(`\nWriting per-size dataset files to ${OUT_DIR}\n`);
    for (const size of targets) {
        if (cache.length < size + (SUPPORTED_SIZES.slice(0, SUPPORTED_SIZES.indexOf(size)).reduce((a, b) => a + b, 0))) {
            console.error(`skipping size=${size}: cache too small`);
            continue;
        }
        writeOneSize(cache, size);
    }
    console.log('\nDone.');
}

main().catch((err) => {
    console.error('\nFailed:', err.message);
    if (err.response) console.error('response:', err.response.status);
    process.exit(1);
});
