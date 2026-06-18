function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
            if (ch === '"') inQ = false;
            else cur += ch;
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

function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length <= 1) return [];
    const header = parseCsvLine(lines[0]);
    const hasType = header.includes('query_type');
    const out = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        let idx = 0;
        const row = {
            size: parseInt(cols[idx++], 10),
            query: cols[idx++],
            queryType: hasType ? cols[idx++] : 'single',
            repetition: parseInt(cols[idx++], 10),
            latencyMs: parseFloat(cols[idx++]),
            resultCount: parseInt(cols[idx++], 10),
            status: cols[idx++],
        };
        out.push(row);
    }
    return out;
}

function percentile(sortedAsc, p) {
    if (sortedAsc.length === 0) return null;
    const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
    return sortedAsc[idx];
}

function statsFor(rows) {
    const okLatencies = rows
        .filter((r) => r.status === 'ok')
        .map((r) => r.latencyMs)
        .sort((a, b) => a - b);
    if (okLatencies.length === 0) return null;
    const errorCount = rows.filter((r) => r.status !== 'ok').length;
    return {
        n: rows.length,
        medianMs: percentile(okLatencies, 0.5),
        meanMs: okLatencies.reduce((s, x) => s + x, 0) / okLatencies.length,
        p90Ms: percentile(okLatencies, 0.9),
        p99Ms: percentile(okLatencies, 0.99),
        errorRate: errorCount / rows.length,
    };
}

function summarizeCsv(text) {
    const rows = parseCsv(text);
    if (rows.length === 0) return null;
    const warmed = rows.filter((r) => r.repetition > 1);
    if (warmed.length === 0) return null;
    const overall = statsFor(warmed);
    const single = statsFor(warmed.filter((r) => r.queryType === 'single'));
    const multi = statsFor(warmed.filter((r) => r.queryType === 'multi'));
    const errorCountAll = rows.filter((r) => r.status !== 'ok').length;
    return {
        size: rows[0].size,
        ...overall,
        errorRate: errorCountAll / rows.length,
        single,
        multi,
    };
}

function mergeSummaries(summaries) {
    const bySize = new Map();
    for (const s of summaries) {
        if (!bySize.has(s.size)) bySize.set(s.size, { size: s.size });
        bySize.get(s.size)[s.arch] = {
            medianMs: s.medianMs,
            meanMs: s.meanMs,
            p90Ms: s.p90Ms,
            p99Ms: s.p99Ms,
            n: s.n,
            errorRate: s.errorRate,
            single: s.single,
            multi: s.multi,
        };
    }
    return Array.from(bySize.values()).sort((a, b) => a.size - b.size);
}

function fmt(n) {
    if (n == null) return '—';
    if (n >= 100) return n.toFixed(0);
    if (n >= 10) return n.toFixed(1);
    return n.toFixed(2);
}

function formatMarkdown(rows) {
    const lines = [
        '| size | new median (ms) | new p90 (ms) | new n | old median (ms) | old p90 (ms) | old n |',
        '|------|-----------------|--------------|-------|-----------------|--------------|-------|',
    ];
    for (const r of rows) {
        const newPart = r.new
            ? `${fmt(r.new.medianMs)} | ${fmt(r.new.p90Ms)} | ${r.new.n}`
            : '— | — | —';
        const oldPart = r.old
            ? `${fmt(r.old.medianMs)} | ${fmt(r.old.p90Ms)} | ${r.old.n}`
            : '— | — | —';
        lines.push(`| ${r.size} | ${newPart} | ${oldPart} |`);
    }
    return lines.join('\n');
}

function formatMarkdownByType(rows) {
    const lines = [
        '| size | type | new median (ms) | new p90 (ms) | old median (ms) | old p90 (ms) |',
        '|------|------|-----------------|--------------|-----------------|--------------|',
    ];
    for (const r of rows) {
        for (const type of ['single', 'multi']) {
            const n = r.new && r.new[type];
            const o = r.old && r.old[type];
            const newPart = n ? `${fmt(n.medianMs)} | ${fmt(n.p90Ms)}` : '— | —';
            const oldPart = o ? `${fmt(o.medianMs)} | ${fmt(o.p90Ms)}` : '— | —';
            lines.push(`| ${r.size} | ${type} | ${newPart} | ${oldPart} |`);
        }
    }
    return lines.join('\n');
}

module.exports = {
    summarizeCsv,
    mergeSummaries,
    formatMarkdown,
    formatMarkdownByType,
    parseCsv,
    fmt,
};
