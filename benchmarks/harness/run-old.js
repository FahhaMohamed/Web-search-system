/**
 * Benchmark harness for the Previous Architecture (namenode).
 *
 * Endpoint: GET /search?q=<text>
 * Response: { status, message, results: [splitFile, ...] }
 *
 * Queries may be strings (treated as single-token) or { text, type } objects.
 * Returns rows: { query, queryType, repetition, latencyMs, resultCount, status }
 */

const axios = require('axios');

function normalizeQuery(q) {
    if (typeof q === 'string') return { text: q, type: 'single' };
    return { text: q.text, type: q.type || 'single' };
}

async function runBenchmarkOld({
    searchApiUrl,
    queries,
    repetitions = 10,
    onProgress = () => {},
}) {
    const rows = [];
    for (const raw of queries) {
        const q = normalizeQuery(raw);
        for (let rep = 1; rep <= repetitions; rep++) {
            let status = 'ok';
            let resultCount = 0;
            const start = process.hrtime.bigint();
            try {
                const res = await axios.get(`${searchApiUrl}/search`, { params: { q: q.text } });
                resultCount = Array.isArray(res.data.results) ? res.data.results.length : 0;
            } catch (_) {
                status = 'error';
            }
            const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
            rows.push({
                query: q.text,
                queryType: q.type,
                repetition: rep,
                latencyMs,
                resultCount,
                status,
            });
            onProgress({ phase: 'query', query: q.text, queryType: q.type, repetition: rep });
        }
    }
    return rows;
}

module.exports = { runBenchmarkOld, normalizeQuery };
