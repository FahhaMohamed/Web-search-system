/**
 * Black-box benchmark runner for Elasticsearch.
 *
 * Speaks only HTTP to :9200, the same way any developer using Elastic would.
 * No SDKs, no internal hooks.
 *
 * Three phases (each timed separately so the orchestrator can record setup
 * time vs indexing time vs search latency without mixing them):
 *   - setupElastic(...)      → DELETE old index, PUT new with our mapping
 *   - indexElastic(...)      → bulk-POST docs, then force refresh
 *   - runQueriesElastic(...) → translate canonical query, POST /_search,
 *                              wrap `process.hrtime.bigint()` around the
 *                              search call only.
 *
 * Row schema (CSV-compatible with Task 2's analyzer):
 *   { query, queryType, repetition, latencyMs, resultCount, status }
 */

const axios = require('axios');
const { toElastic } = require('../queries/translate');

const DEFAULT_ES_URL = process.env.ES_URL || 'http://localhost:9200';

function nowNs() {
    return process.hrtime.bigint();
}

function msSince(startNs) {
    return Number(process.hrtime.bigint() - startNs) / 1_000_000;
}

async function setupElastic({ domain, mapping, esUrl = DEFAULT_ES_URL }) {
    const startNs = nowNs();
    // DELETE if exists (404 is fine — index just doesn't exist yet)
    try {
        await axios.delete(`${esUrl}/${domain}`, { timeout: 30000 });
    } catch (err) {
        const status = err.response && err.response.status;
        if (status !== 404) {
            throw new Error(`elastic DELETE /${domain} failed: ${err.message}`);
        }
    }
    // PUT mapping
    try {
        await axios.put(`${esUrl}/${domain}`, mapping, {
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err) {
        const body = err.response && err.response.data;
        throw new Error(
            `elastic PUT /${domain} failed: ${err.message} ${body ? JSON.stringify(body) : ''}`,
        );
    }
    return { setupMs: msSince(startNs) };
}

function buildBulkBody(docs) {
    // NDJSON: alternating action + source lines, newline-terminated
    const lines = [];
    for (const doc of docs) {
        const { id, ...source } = doc;
        lines.push(JSON.stringify({ index: { _id: id } }));
        lines.push(JSON.stringify(source));
    }
    return lines.join('\n') + '\n';
}

async function indexElastic({
    domain,
    docs,
    batchSize = 500,
    esUrl = DEFAULT_ES_URL,
    onProgress = null,
}) {
    const startNs = nowNs();
    const total = docs.length;
    for (let i = 0; i < total; i += batchSize) {
        const batch = docs.slice(i, i + batchSize);
        const body = buildBulkBody(batch);
        try {
            const res = await axios.post(`${esUrl}/${domain}/_bulk`, body, {
                timeout: 120000,
                headers: { 'Content-Type': 'application/x-ndjson' },
                maxBodyLength: 200 * 1024 * 1024,
            });
            if (res.data && res.data.errors) {
                const firstErrItem = (res.data.items || []).find(
                    (it) => it.index && it.index.error,
                );
                if (firstErrItem) {
                    throw new Error(
                        `elastic _bulk had item errors: ${JSON.stringify(firstErrItem.index.error)}`,
                    );
                }
            }
        } catch (err) {
            throw new Error(`elastic _bulk batch ${i}-${i + batch.length} failed: ${err.message}`);
        }
        if (onProgress) {
            onProgress({
                phase: 'bulk',
                indexed: Math.min(i + batchSize, total),
                total,
            });
        }
    }
    // Force refresh so docs are immediately searchable
    await axios.post(`${esUrl}/${domain}/_refresh`, null, { timeout: 30000 });
    return { indexingMs: msSince(startNs), indexed: total };
}

async function searchOnce({ domain, body, esUrl = DEFAULT_ES_URL }) {
    const start = nowNs();
    let status = 'ok';
    let resultCount = 0;
    try {
        const res = await axios.post(`${esUrl}/${domain}/_search`, body, {
            timeout: 60000,
            headers: { 'Content-Type': 'application/json' },
        });
        const hits = res.data && res.data.hits;
        resultCount = (hits && hits.hits && hits.hits.length) || 0;
    } catch (_err) {
        status = 'error';
    }
    return { latencyMs: msSince(start), status, resultCount };
}

async function runQueriesElastic({
    domain,
    queries,
    reps = 10,
    esUrl = DEFAULT_ES_URL,
    onProgress = null,
}) {
    const rows = [];
    for (let qi = 0; qi < queries.length; qi++) {
        const canonical = queries[qi];
        const body = toElastic(canonical, domain);
        const queryStr = canonical.tokens || `${canonical.field}${canonical.op || ':'}${canonical.value}`;
        const queryType = canonical.kind === 'text' ? canonical.tokenType : canonical.kind;
        for (let r = 1; r <= reps; r++) {
            const { latencyMs, status, resultCount } = await searchOnce({ domain, body, esUrl });
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

async function teardownElastic({ domain, esUrl = DEFAULT_ES_URL }) {
    try {
        await axios.delete(`${esUrl}/${domain}`, { timeout: 30000 });
    } catch (err) {
        const status = err.response && err.response.status;
        if (status !== 404) {
            // teardown failure shouldn't break the whole experiment
            console.warn(`elastic teardown DELETE /${domain} warning: ${err.message}`);
        }
    }
}

module.exports = {
    setupElastic,
    indexElastic,
    runQueriesElastic,
    searchOnce,
    teardownElastic,
    buildBulkBody,
    DEFAULT_ES_URL,
};
