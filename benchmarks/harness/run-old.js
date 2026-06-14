/**
 * Benchmark harness for the namenode (previous) architecture.
 *
 * The old architecture serves a pre-built static index. Data loading happens
 * offline (cleaner -> map -> reduce builds /dfs/index.json before search-api
 * comes up). This harness only fires queries and records latency -- the data
 * loading is handled by the experiment runner in Step 7.
 *
 * Endpoint: GET /search?q=<word>
 * Response: { status, message, results: [splitFile, ...] }
 *
 * Returns rows: { query, repetition, latencyMs, resultCount, status }
 */

const axios = require('axios');

async function runBenchmarkOld({
    searchApiUrl,
    queries,
    repetitions = 10,
    onProgress = () => {},
}) {
    const rows = [];
    for (const query of queries) {
        for (let rep = 1; rep <= repetitions; rep++) {
            let status = 'ok';
            let resultCount = 0;
            const start = process.hrtime.bigint();
            try {
                const res = await axios.get(`${searchApiUrl}/search`, { params: { q: query } });
                resultCount = Array.isArray(res.data.results) ? res.data.results.length : 0;
            } catch (_) {
                status = 'error';
            }
            const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
            rows.push({ query, repetition: rep, latencyMs, resultCount, status });
            onProgress({ phase: 'query', query, repetition: rep });
        }
    }
    return rows;
}

module.exports = { runBenchmarkOld };
