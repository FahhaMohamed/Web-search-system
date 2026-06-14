function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length <= 1) return [];
    const out = [];
    for (let i = 1; i < lines.length; i++) {
        const [size, query, repetition, latency_ms, result_count, status] = lines[i].split(',');
        out.push({
            size: parseInt(size, 10),
            query,
            repetition: parseInt(repetition, 10),
            latencyMs: parseFloat(latency_ms),
            resultCount: parseInt(result_count, 10),
            status,
        });
    }
    return out;
}

function percentile(sortedAsc, p) {
    if (sortedAsc.length === 0) return null;
    const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
    return sortedAsc[idx];
}

function summarizeCsv(text) {
    const rows = parseCsv(text);
    if (rows.length === 0) return null;
    const warmed = rows.filter((r) => r.repetition > 1);
    if (warmed.length === 0) return null;
    const okLatencies = warmed
        .filter((r) => r.status === 'ok')
        .map((r) => r.latencyMs)
        .sort((a, b) => a - b);
    const errorCount = rows.filter((r) => r.status !== 'ok').length;
    return {
        size: rows[0].size,
        n: warmed.length,
        medianMs: percentile(okLatencies, 0.5),
        meanMs: okLatencies.reduce((s, x) => s + x, 0) / okLatencies.length,
        p90Ms: percentile(okLatencies, 0.9),
        p99Ms: percentile(okLatencies, 0.99),
        errorRate: errorCount / rows.length,
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

module.exports = { summarizeCsv, mergeSummaries, formatMarkdown, parseCsv };
