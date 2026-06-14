/**
 * Benchmark harness for the 3rd architecture (current branch).
 *
 * Flow:
 *   1. Register schema with Schema Registry
 *   2. Index documents via Gateway /api/index (batched)
 *   3. Fire each query × repetitions times against Gateway /api/search
 *      and record client-side wall-clock latency per request
 *
 * Returns an array of rows: { query, repetition, latencyMs, resultCount, status }
 * Pure library -- no fs, no CLI. CLI wrapper lives separately.
 */

const axios = require('axios');

async function runBenchmark({
    schemaRegistryUrl,
    gatewayUrl,
    domain,
    schema,
    documents,
    queries,
    repetitions = 10,
    batchSize = 1000,
    onProgress = () => {},
}) {
    await axios.post(`${schemaRegistryUrl}/schema/${domain}`, schema);
    onProgress({ phase: 'schema-registered' });

    const indexStart = process.hrtime.bigint();
    const batchCount = Math.ceil(documents.length / batchSize);
    for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        await axios.post(`${gatewayUrl}/api/index`, { domain, documents: batch });
        onProgress({ phase: 'index', batch: i / batchSize + 1, total: batchCount });
    }
    const indexingMs = Number(process.hrtime.bigint() - indexStart) / 1_000_000;

    const rows = [];
    for (const query of queries) {
        for (let rep = 1; rep <= repetitions; rep++) {
            let status = 'ok';
            let resultCount = 0;
            const start = process.hrtime.bigint();
            try {
                const res = await axios.post(`${gatewayUrl}/api/search`, { domain, query });
                resultCount = Array.isArray(res.data.results) ? res.data.results.length : 0;
            } catch (_) {
                status = 'error';
            }
            const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
            rows.push({ query, repetition: rep, latencyMs, resultCount, status });
            onProgress({ phase: 'query', query, repetition: rep });
        }
    }
    return { rows, indexingMs };
}

module.exports = { runBenchmark };
