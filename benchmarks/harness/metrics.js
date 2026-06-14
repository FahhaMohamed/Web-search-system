/**
 * Pure statistics functions used to summarize raw latency rows.
 *
 * Methodology notes:
 *   - Percentiles use the nearest-rank method (rank = ceil(p/100 * N)).
 *     Standard for benchmark reporting; behaves cleanly at small N.
 *   - Throughput = number of queries / total wall-clock seconds.
 */

function percentile(sortedAsc, p) {
    if (sortedAsc.length === 0) return 0;
    const rank = Math.ceil((p / 100) * sortedAsc.length);
    const idx = Math.max(0, Math.min(sortedAsc.length - 1, rank - 1));
    return sortedAsc[idx];
}

function computeStats(latencies, totalElapsedMs) {
    if (!latencies || latencies.length === 0) {
        return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, throughput: 0 };
    }
    const sorted = [...latencies].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((s, v) => s + v, 0);
    return {
        count,
        min: sorted[0],
        max: sorted[count - 1],
        avg: sum / count,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        throughput: totalElapsedMs > 0 ? count / (totalElapsedMs / 1000) : 0,
    };
}

module.exports = { computeStats, percentile };
