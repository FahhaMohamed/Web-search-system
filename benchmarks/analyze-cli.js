#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { summarizeCsv, mergeSummaries, formatMarkdown } = require('./analyze');

const RESULTS_DIR = path.join(__dirname, 'results');
const SIZES = [100, 1000, 10000, 100000];
const ARCHES = ['new', 'old'];

function main() {
    const summaries = [];
    for (const arch of ARCHES) {
        for (const size of SIZES) {
            const p = path.join(RESULTS_DIR, `${arch}-${size}.csv`);
            if (!fs.existsSync(p)) continue;
            const text = fs.readFileSync(p, 'utf-8');
            const s = summarizeCsv(text);
            if (s) summaries.push({ arch, ...s });
        }
    }

    const rows = mergeSummaries(summaries);
    const md = formatMarkdown(rows);
    const outPath = path.join(RESULTS_DIR, 'summary.md');
    fs.writeFileSync(outPath, md + '\n');

    console.log(md);
    console.log(`\nWrote ${outPath}`);
}

main();
