/**
 * Black-box benchmark runner for Apache Solr.
 *
 * Speaks only HTTP to :8983, the same way any developer using Solr would.
 * Cores are precreated at docker-compose startup (see
 * docker-compose.external.yml), so setup just deletes any existing docs
 * to give each benchmark cell a clean slate.
 *
 * Phases (each timed separately):
 *   - setupSolr(...)      → POST /solr/<domain>/update with <delete><query>*:*
 *                           and commit=true to clear the core
 *   - indexSolr(...)      → POST /solr/<domain>/update?commit=true with JSON
 *                           array of docs (Solr's schemaless mode auto-
 *                           creates fields based on doc content)
 *   - runQueriesSolr(...) → GET /solr/<domain>/select?q=<lucene-query>&rows=n
 *                           wrap `process.hrtime.bigint()` around the call
 *
 * Row schema matches Elastic/OpenSearch/Ours so summary.csv stays uniform.
 */

const axios = require('axios');
const { toSolr } = require('../queries/translate');

const DEFAULT_SOLR_URL = process.env.SOLR_URL || 'http://localhost:8983';

function nowNs() { return process.hrtime.bigint(); }
function msSince(startNs) { return Number(process.hrtime.bigint() - startNs) / 1_000_000; }

async function setupSolr({ domain, solrUrl = DEFAULT_SOLR_URL }) {
    const startNs = nowNs();
    // Delete every doc in the core so this cell starts clean.
    try {
        await axios.post(
            `${solrUrl}/solr/${domain}/update?commit=true`,
            { delete: { query: '*:*' } },
            { timeout: 30000, headers: { 'Content-Type': 'application/json' } },
        );
    } catch (err) {
        const body = err.response && err.response.data;
        throw new Error(
            `solr delete-all on core "${domain}" failed: ${err.message} ${body ? JSON.stringify(body) : ''}`,
        );
    }
    return { setupMs: msSince(startNs) };
}

async function indexSolr({
    domain,
    docs,
    batchSize = 500,
    solrUrl = DEFAULT_SOLR_URL,
    onProgress = null,
}) {
    const startNs = nowNs();
    const total = docs.length;
    for (let i = 0; i < total; i += batchSize) {
        const batch = docs.slice(i, i + batchSize);
        try {
            // No commit per batch — one commit at the end is faster and
            // matches Elastic's "bulk then refresh" pattern.
            await axios.post(
                `${solrUrl}/solr/${domain}/update`,
                batch,
                {
                    timeout: 120000,
                    headers: { 'Content-Type': 'application/json' },
                    maxBodyLength: 200 * 1024 * 1024,
                },
            );
        } catch (err) {
            const body = err.response && err.response.data;
            throw new Error(
                `solr POST /update batch ${i}-${i + batch.length} failed: ${err.message} ${body ? JSON.stringify(body) : ''}`,
            );
        }
        if (onProgress) {
            onProgress({ phase: 'bulk', indexed: Math.min(i + batchSize, total), total });
        }
    }
    // Single commit to make docs searchable.
    await axios.post(
        `${solrUrl}/solr/${domain}/update?commit=true`,
        {},
        { timeout: 60000, headers: { 'Content-Type': 'application/json' } },
    );
    return { indexingMs: msSince(startNs), indexed: total };
}

async function searchOnce({ domain, params, solrUrl = DEFAULT_SOLR_URL }) {
    const start = nowNs();
    let status = 'ok';
    let resultCount = 0;
    try {
        const res = await axios.get(`${solrUrl}/solr/${domain}/select`, {
            params,
            timeout: 60000,
        });
        const docs = res.data && res.data.response && res.data.response.docs;
        resultCount = Array.isArray(docs) ? docs.length : 0;
    } catch (_err) {
        status = 'error';
    }
    return { latencyMs: msSince(start), status, resultCount };
}

async function runQueriesSolr({
    domain,
    queries,
    reps = 10,
    solrUrl = DEFAULT_SOLR_URL,
    onProgress = null,
}) {
    const rows = [];
    for (let qi = 0; qi < queries.length; qi++) {
        const canonical = queries[qi];
        const params = toSolr(canonical, domain);
        const queryStr = canonical.tokens || `${canonical.field}${canonical.op || ':'}${canonical.value}`;
        const queryType = canonical.kind === 'text' ? canonical.tokenType : canonical.kind;
        for (let r = 1; r <= reps; r++) {
            const { latencyMs, status, resultCount } = await searchOnce({ domain, params, solrUrl });
            rows.push({ query: queryStr, queryType, repetition: r, latencyMs, resultCount, status });
            if (onProgress) {
                onProgress({ phase: 'query', queryIndex: qi, repetition: r, latencyMs, status });
            }
        }
    }
    return { rows };
}

async function teardownSolr({ domain, solrUrl = DEFAULT_SOLR_URL }) {
    // Delete all docs — keep the core intact so the next cell can reuse it.
    try {
        await axios.post(
            `${solrUrl}/solr/${domain}/update?commit=true`,
            { delete: { query: '*:*' } },
            { timeout: 30000, headers: { 'Content-Type': 'application/json' } },
        );
    } catch (err) {
        console.warn(`solr teardown warning for core "${domain}": ${err.message}`);
    }
}

module.exports = {
    setupSolr,
    indexSolr,
    runQueriesSolr,
    teardownSolr,
    searchOnce,
    DEFAULT_SOLR_URL,
};
