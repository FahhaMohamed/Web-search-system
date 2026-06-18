/**
 * Benchmark harness for the Optimized Architecture.
 *
 * Flow:
 *   1. Register schema with Schema Registry
 *   2. Index documents via Gateway /api/index (batched)
 *   3. Fire each query × repetitions times against Gateway /api/search
 *      and record client-side wall-clock latency per request
 *
 * Queries may be plain strings (treated as single-token) or
 * { text, type } objects where type is 'single' or 'multi'.
 *
 * Returns { rows, indexingMs }. Each row has:
 *   { query, queryType, repetition, latencyMs, resultCount, status }
 */

const axios = require('axios');

function normalizeQuery(q) {
    if (typeof q === 'string') return { text: q, type: 'single' };
    return { text: q.text, type: q.type || 'single' };
}

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
    // Schema registration
    await axios.post(`${schemaRegistryUrl}/schema/${domain}`, schema);
    onProgress({ phase: 'schema-registered' });

    //Storing the documents 
    const indexStart = process.hrtime.bigint();
    const batchCount = Math.ceil(documents.length / batchSize);
    for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        await axios.post(`${gatewayUrl}/api/index`, { domain, documents: batch });
        onProgress({ phase: 'index', batch: i / batchSize + 1, total: batchCount });
    }
    const indexingMs = Number(process.hrtime.bigint() - indexStart) / 1_000_000;

    //Searching for queries
    const rows = [];
    for (const raw of queries) {
        const q = normalizeQuery(raw);
        for (let rep = 1; rep <= repetitions; rep++) {
            let status = 'ok';
            let resultCount = 0;
            const start = process.hrtime.bigint();
            try {
                const res = await axios.post(`${gatewayUrl}/api/search`, { domain, query: q.text });
                resultCount = Array.isArray(res.data.results) ? res.data.results.length : 0;
            } catch (_) {
                status = 'error';
            }
            //findout the latency
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
    return { rows, indexingMs };
}

module.exports = { runBenchmark, normalizeQuery };
