/**
 * Black-box benchmark runner for OUR optimized architecture.
 *
 * Speaks only public HTTP — Schema Registry at :5000 for setup, Gateway at
 * :3000 for indexing and search. Same protocol the Elastic runner uses.
 *
 * Three phases (each timed separately so the orchestrator can record
 * setup vs indexing vs search separately):
 *   - setupOurs(...)       → POST /schema/<domain> on Schema Registry
 *                            (also tries to clear prior data via shard ops
 *                            — but our system has no DELETE-by-index API
 *                            yet, so we rely on docker compose down between
 *                            runs upstream for clean state)
 *   - indexOurs(...)       → POST /api/index on Gateway, batched
 *   - runQueriesOurs(...)  → POST /api/search per canonical query,
 *                            wrap `process.hrtime.bigint()` around the call
 *
 * Row schema matches the others for analyzer compatibility.
 *
 * NOTE: our system doesn't expose a "delete index" endpoint. We register
 * the schema (idempotent) and re-index from scratch each run. To get a
 * truly clean state, the orchestrator (or operator) is expected to wipe
 * the data/ directory and bring the stack back up before benchmarking.
 */

const axios = require('axios');
const { toOurs } = require('../queries/translate');

const DEFAULT_SCHEMA_URL = process.env.OURS_SCHEMA_URL || 'http://localhost:5000';
const DEFAULT_GATEWAY_URL = process.env.OURS_GATEWAY_URL || 'http://localhost:3000';

function nowNs() {
    return process.hrtime.bigint();
}

function msSince(startNs) {
    return Number(process.hrtime.bigint() - startNs) / 1_000_000;
}

async function setupOurs({
    domain,
    schema,
    schemaUrl = DEFAULT_SCHEMA_URL,
}) {
    const startNs = nowNs();
    // POST creates the schema; if it already exists, PUT updates it.
    // First try POST; on 4xx fall back to PUT.
    try {
        await axios.post(`${schemaUrl}/schema/${domain}`, schema, {
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err) {
        const status = err.response && err.response.status;
        if (status && status >= 400 && status < 500) {
            try {
                await axios.put(`${schemaUrl}/schema/${domain}`, schema, {
                    timeout: 30000,
                    headers: { 'Content-Type': 'application/json' },
                });
            } catch (e2) {
                const body = e2.response && e2.response.data;
                throw new Error(
                    `ours setup PUT /schema/${domain} failed: ${e2.message} ${body ? JSON.stringify(body) : ''}`,
                );
            }
        } else {
            const body = err.response && err.response.data;
            throw new Error(
                `ours setup POST /schema/${domain} failed: ${err.message} ${body ? JSON.stringify(body) : ''}`,
            );
        }
    }
    return { setupMs: msSince(startNs) };
}

async function indexOurs({
    domain,
    docs,
    batchSize = 500,
    gatewayUrl = DEFAULT_GATEWAY_URL,
    onProgress = null,
}) {
    const startNs = nowNs();
    const total = docs.length;
    for (let i = 0; i < total; i += batchSize) {
        const batch = docs.slice(i, i + batchSize);
        try {
            await axios.post(
                `${gatewayUrl}/api/index`,
                { domain, documents: batch },
                {
                    timeout: 300000,
                    headers: { 'Content-Type': 'application/json' },
                    maxBodyLength: 200 * 1024 * 1024,
                },
            );
        } catch (err) {
            const body = err.response && err.response.data;
            throw new Error(
                `ours POST /api/index batch ${i}-${i + batch.length} failed: ${err.message} ${body ? JSON.stringify(body) : ''}`,
            );
        }
        if (onProgress) {
            onProgress({
                phase: 'bulk',
                indexed: Math.min(i + batchSize, total),
                total,
            });
        }
    }
    return { indexingMs: msSince(startNs), indexed: total };
}

async function searchOnce({ body, gatewayUrl = DEFAULT_GATEWAY_URL }) {
    const start = nowNs();
    let status = 'ok';
    let resultCount = 0;
    try {
        const res = await axios.post(`${gatewayUrl}/api/search`, body, {
            timeout: 60000,
            headers: { 'Content-Type': 'application/json' },
        });
        resultCount = (res.data && Array.isArray(res.data.results) && res.data.results.length) || 0;
    } catch (_err) {
        status = 'error';
    }
    return { latencyMs: msSince(start), status, resultCount };
}

async function runQueriesOurs({
    domain,
    queries,
    reps = 10,
    gatewayUrl = DEFAULT_GATEWAY_URL,
    onProgress = null,
}) {
    const rows = [];
    for (let qi = 0; qi < queries.length; qi++) {
        const canonical = queries[qi];
        const body = toOurs(canonical, domain);
        const queryStr = canonical.tokens || `${canonical.field}${canonical.op || ':'}${canonical.value}`;
        const queryType = canonical.kind === 'text' ? canonical.tokenType : canonical.kind;
        for (let r = 1; r <= reps; r++) {
            const { latencyMs, status, resultCount } = await searchOnce({ body, gatewayUrl });
            rows.push({
                query: queryStr,
                queryType,
                repetition: r,
                latencyMs,
                resultCount,
                status,
            });
            if (onProgress) {
                onProgress({
                    phase: 'query',
                    queryIndex: qi,
                    repetition: r,
                    latencyMs,
                    status,
                });
            }
        }
    }
    return { rows };
}

async function teardownOurs(/* { domain } */) {
    // Our system has no DELETE-index API. Schemas remain in the registry
    // between cells, which is fine — cells just re-index from scratch.
    // For a truly clean state between sizes, the operator brings the
    // stack down + wipes data/ + brings it up (orchestrator does this
    // externally, not here).
    return;
}

module.exports = {
    setupOurs,
    indexOurs,
    runQueriesOurs,
    searchOnce,
    teardownOurs,
    DEFAULT_SCHEMA_URL,
    DEFAULT_GATEWAY_URL,
};
