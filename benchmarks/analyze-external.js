#!/usr/bin/env node
/**
 * External-benchmark analyzer.
 *
 * Reads every <engine>-<domain>-<size>.csv in benchmarks/results/ and
 * prints a Markdown summary table. Drops cold-start (repetition == 1)
 * before computing percentiles, same rule as Task 2.
 *
 * Outputs a per-engine table at three percentiles: median, p90, p99.
 * Optionally writes a Markdown file (--out <path>).
 *
 * Usage:
 *   node benchmarks/analyze-external.js
 *   node benchmarks/analyze-external.js --out docs/research/03-results.md
 */

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'results');

function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length <= 1) return [];
    const header = lines[0].split(',');
    const out = [];
    for (let i = 1; i < lines.length; i++) {
        // Simple CSV: query field is quoted, others not
        const row = parseRow(lines[i]);
        if (!row || row.length !== header.length) continue;
        const r = {};
        for (let j = 0; j < header.length; j++) r[header[j]] = row[j];
        out.push({
            engine: r.engine,
            domain: r.domain,
            size: parseInt(r.size, 10),
            query: r.query,
            queryType: r.query_type,
            repetition: parseInt(r.repetition, 10),
            latencyMs: parseFloat(r.latency_ms),
            resultCount: parseInt(r.result_count, 10),
            status: r.status,
        });
    }
    return out;
}

function parseRow(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
            if (ch === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; }
                else inQ = false;
            } else cur += ch;
        } else if (ch === '"') {
            inQ = true;
        } else if (ch === ',') {
            out.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out;
}

function percentile(sortedAsc, p) {
    if (sortedAsc.length === 0) return null;
    const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
    return sortedAsc[idx];
}

function statsFor(rows) {
    const ok = rows.filter((r) => r.status === 'ok');
    const lat = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
    if (lat.length === 0) return null;
    const errorCount = rows.length - ok.length;
    return {
        n: rows.length,
        nOk: ok.length,
        errors: errorCount,
        meanMs: lat.reduce((s, x) => s + x, 0) / lat.length,
        medianMs: percentile(lat, 0.5),
        p90Ms: percentile(lat, 0.9),
        p99Ms: percentile(lat, 0.99),
        minMs: lat[0],
        maxMs: lat[lat.length - 1],
    };
}

function loadAllRows() {
    if (!fs.existsSync(RESULTS_DIR)) return [];
    const files = fs
        .readdirSync(RESULTS_DIR)
        .filter((f) => f.endsWith('.csv') && f !== 'summary.csv')
        .sort();
    const all = [];
    for (const f of files) {
        const text = fs.readFileSync(path.join(RESULTS_DIR, f), 'utf-8');
        const rows = parseCsv(text);
        all.push(...rows);
    }
    return all;
}

function readSummary() {
    const p = path.join(RESULTS_DIR, 'summary.csv');
    if (!fs.existsSync(p)) return [];
    const text = fs.readFileSync(p, 'utf-8');
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const out = [];
    for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(',');
        out.push({
            engine: c[0],
            domain: c[1],
            size: parseInt(c[2], 10),
            setupMs: parseFloat(c[3]),
            indexingMs: parseFloat(c[4]),
            indexed: parseInt(c[5], 10),
            queryRows: parseInt(c[6], 10),
            errorRows: parseInt(c[7], 10),
            timestamp: c[8],
        });
    }
    // Keep only the LATEST entry per (engine, domain, size) — replaces smoke-test stubs
    const byKey = new Map();
    for (const r of out) {
        const k = `${r.engine}|${r.domain}|${r.size}`;
        const prev = byKey.get(k);
        if (!prev || new Date(r.timestamp) > new Date(prev.timestamp)) {
            byKey.set(k, r);
        }
    }
    return Array.from(byKey.values());
}

function fmt(n) {
    if (n == null) return '—';
    if (n >= 100) return n.toFixed(0);
    if (n >= 10) return n.toFixed(1);
    return n.toFixed(2);
}

function buildLatencyTable(rows) {
    // Group by (engine, domain, size), keep warm only (rep > 1)
    const warm = rows.filter((r) => r.repetition > 1);
    const groups = new Map();
    for (const r of warm) {
        const k = `${r.engine}|${r.domain}|${r.size}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
    }
    const cells = [];
    for (const [k, grp] of groups.entries()) {
        const [engine, domain, sizeStr] = k.split('|');
        const size = parseInt(sizeStr, 10);
        cells.push({ engine, domain, size, stats: statsFor(grp) });
    }
    cells.sort(
        (a, b) =>
            a.engine.localeCompare(b.engine) ||
            a.domain.localeCompare(b.domain) ||
            a.size - b.size,
    );

    const lines = [
        '| engine | domain | size | n | median (ms) | p90 (ms) | p99 (ms) | errors |',
        '|--------|--------|-----:|---:|---:|---:|---:|---:|',
    ];
    for (const c of cells) {
        const s = c.stats;
        lines.push(
            `| ${c.engine} | ${c.domain} | ${c.size} | ${s.nOk} | ${fmt(s.medianMs)} | ${fmt(s.p90Ms)} | ${fmt(s.p99Ms)} | ${s.errors} |`,
        );
    }
    return lines.join('\n');
}

function buildLatencyByType(rows) {
    // Same but split by query_type
    const warm = rows.filter((r) => r.repetition > 1);
    const groups = new Map();
    for (const r of warm) {
        const k = `${r.engine}|${r.domain}|${r.size}|${r.queryType}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
    }
    const cells = [];
    for (const [k, grp] of groups.entries()) {
        const [engine, domain, sizeStr, queryType] = k.split('|');
        cells.push({
            engine,
            domain,
            size: parseInt(sizeStr, 10),
            queryType,
            stats: statsFor(grp),
        });
    }
    cells.sort(
        (a, b) =>
            a.engine.localeCompare(b.engine) ||
            a.domain.localeCompare(b.domain) ||
            a.size - b.size ||
            a.queryType.localeCompare(b.queryType),
    );
    const lines = [
        '| engine | domain | size | query type | median (ms) | p90 (ms) | p99 (ms) |',
        '|--------|--------|-----:|------------|---:|---:|---:|',
    ];
    for (const c of cells) {
        const s = c.stats;
        lines.push(
            `| ${c.engine} | ${c.domain} | ${c.size} | ${c.queryType} | ${fmt(s.medianMs)} | ${fmt(s.p90Ms)} | ${fmt(s.p99Ms)} |`,
        );
    }
    return lines.join('\n');
}

function buildSetupTable(summaryRows) {
    const lines = [
        '| engine | domain | size | setup (ms) | indexing (ms) | indexed | query rows | errors |',
        '|--------|--------|-----:|---:|---:|---:|---:|---:|',
    ];
    summaryRows.sort(
        (a, b) =>
            a.engine.localeCompare(b.engine) ||
            a.domain.localeCompare(b.domain) ||
            a.size - b.size,
    );
    for (const r of summaryRows) {
        lines.push(
            `| ${r.engine} | ${r.domain} | ${r.size} | ${fmt(r.setupMs)} | ${fmt(r.indexingMs)} | ${r.indexed} | ${r.queryRows} | ${r.errorRows} |`,
        );
    }
    return lines.join('\n');
}

function buildHeadlineTable(rows) {
    const warm = rows.filter((r) => r.repetition > 1 && r.status === 'ok');
    if (warm.length === 0) return '';
    const s = statsFor(warm);
    const lines = [
        '| metric | value |',
        '|---|---:|',
        `| Total warmed queries (n) | ${s.nOk} |`,
        `| Median latency | ${fmt(s.medianMs)} ms |`,
        `| Mean latency | ${fmt(s.meanMs)} ms |`,
        `| p90 latency | ${fmt(s.p90Ms)} ms |`,
        `| p99 latency | ${fmt(s.p99Ms)} ms |`,
        `| Min latency | ${fmt(s.minMs)} ms |`,
        `| Max latency | ${fmt(s.maxMs)} ms |`,
        `| Errors | ${s.errors} |`,
    ];
    return lines.join('\n');
}

function buildByDomainTable(rows) {
    const warm = rows.filter((r) => r.repetition > 1);
    const byDom = new Map();
    for (const r of warm) {
        const key = `${r.engine}|${r.domain}`;
        if (!byDom.has(key)) byDom.set(key, []);
        byDom.get(key).push(r);
    }
    const cells = [];
    for (const [k, grp] of byDom.entries()) {
        const [engine, domain] = k.split('|');
        cells.push({ engine, domain, stats: statsFor(grp) });
    }
    cells.sort((a, b) => a.engine.localeCompare(b.engine) || a.domain.localeCompare(b.domain));
    const lines = [
        '| engine | domain | n | median (ms) | p90 (ms) | p99 (ms) |',
        '|---|---|---:|---:|---:|---:|',
    ];
    for (const c of cells) {
        const s = c.stats;
        lines.push(
            `| ${c.engine} | ${c.domain} | ${s.nOk} | ${fmt(s.medianMs)} | ${fmt(s.p90Ms)} | ${fmt(s.p99Ms)} |`,
        );
    }
    return lines.join('\n');
}

function buildByTypeOverall(rows) {
    const warm = rows.filter((r) => r.repetition > 1);
    const byType = new Map();
    for (const r of warm) {
        if (!byType.has(r.queryType)) byType.set(r.queryType, []);
        byType.get(r.queryType).push(r);
    }
    const order = ['single', 'multi', 'range', 'term'];
    const lines = [
        '| query type | n | median (ms) | p90 (ms) | p99 (ms) |',
        '|---|---:|---:|---:|---:|',
    ];
    for (const t of order) {
        const grp = byType.get(t);
        if (!grp) continue;
        const s = statsFor(grp);
        lines.push(`| ${t} | ${s.nOk} | ${fmt(s.medianMs)} | ${fmt(s.p90Ms)} | ${fmt(s.p99Ms)} |`);
    }
    return lines.join('\n');
}

function main() {
    const args = process.argv.slice(2);
    let outPath = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--out' && args[i + 1]) {
            outPath = args[++i];
        }
    }

    const rows = loadAllRows();
    const summary = readSummary();

    const blocks = [];
    blocks.push('# External Benchmark Results\n');
    blocks.push(`> Generated ${new Date().toISOString()}. Cold-start (repetition == 1) excluded from latency stats.\n`);
    blocks.push('## Overall headline\n');
    blocks.push(buildHeadlineTable(rows));
    blocks.push('\n\n## By query type (overall, across all cells)\n');
    blocks.push(buildByTypeOverall(rows));
    blocks.push('\n\n## By domain (overall, across all sizes)\n');
    blocks.push(buildByDomainTable(rows));
    blocks.push('\n\n## Setup + Indexing summary\n');
    blocks.push(buildSetupTable(summary));
    blocks.push('\n\n## Search latency per cell\n');
    blocks.push(buildLatencyTable(rows));
    blocks.push('\n\n## Search latency per cell, broken down by query type\n');
    blocks.push(buildLatencyByType(rows));
    blocks.push('\n');

    const md = blocks.join('\n');
    if (outPath) {
        fs.writeFileSync(outPath, md);
        console.log(`wrote ${outPath}`);
    } else {
        console.log(md);
    }
}

if (require.main === module) main();

module.exports = {
    parseCsv,
    statsFor,
    percentile,
    buildLatencyTable,
    buildLatencyByType,
    buildSetupTable,
};
