#!/usr/bin/env node
/**
 * CLI for generate-dataset.
 *
 * Usage:
 *   node benchmarks/generate-dataset-cli.js                 (all four sizes)
 *   node benchmarks/generate-dataset-cli.js --size 1000     (one size)
 *   node benchmarks/generate-dataset-cli.js --preview       (print sample, write nothing)
 *
 * Writes to benchmarks/datasets/:
 *   docs-<size>.json        (for 3rd-Architecture)
 *   splits-<size>/splitN.txt (for namenode)
 */

const fs = require('fs');
const path = require('path');
const { generateDataset, toOldArchTextSplits } = require('./generate-dataset');

const SIZES = [100, 1000, 10000, 100000];
const SEED = 42;
const OUT_DIR = path.join(__dirname, 'datasets');

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { preview: false, size: null };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--preview') opts.preview = true;
        if (args[i] === '--size' && args[i + 1]) {
            opts.size = parseInt(args[i + 1], 10);
            i++;
        }
    }
    return opts;
}

function writeOneSize(size) {
    const dataset = generateDataset({ size, seed: SEED });

    const jsonPath = path.join(OUT_DIR, `docs-${size}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(dataset.docs, null, 2));
    const jsonBytes = fs.statSync(jsonPath).size;

    const splitsDir = path.join(OUT_DIR, `splits-${size}`);
    fs.mkdirSync(splitsDir, { recursive: true });
    const splits = toOldArchTextSplits(dataset, 3);
    let textBytes = 0;
    for (const [name, content] of Object.entries(splits)) {
        const p = path.join(splitsDir, name);
        fs.writeFileSync(p, content);
        textBytes += fs.statSync(p).size;
    }

    console.log(
        `size=${String(size).padStart(7)}  json=${(jsonBytes / 1024).toFixed(1)} KB  splits=${(textBytes / 1024).toFixed(1)} KB`,
    );
    return dataset;
}

function previewSample() {
    const dataset = generateDataset({ size: 3, seed: SEED });
    console.log('\n-- Schema (for 3rd-Architecture POST /schema) --');
    console.log(JSON.stringify(dataset.schema, null, 2));
    console.log('\n-- First 3 docs (for 3rd-Architecture POST /api/index) --');
    console.log(JSON.stringify(dataset.docs, null, 2));
    console.log('\n-- First lines of split1.txt (for namenode /dfs/) --');
    const splits = toOldArchTextSplits(dataset, 3);
    console.log(splits['split1.txt']);
}

function main() {
    const opts = parseArgs();
    if (opts.preview) {
        previewSample();
        return;
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const targets = opts.size ? [opts.size] : SIZES;
    console.log(`Writing datasets to ${OUT_DIR}\n`);
    for (const size of targets) writeOneSize(size);
    console.log('\nDone.');
}

main();
