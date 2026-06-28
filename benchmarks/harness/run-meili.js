/**
 * Black-box benchmark runner for Meilisearch.
 *
 * Speaks only HTTP to :7700, the same way any developer would.
 *
 * Three phases (each timed separately):
 *   - setupMeili(...)        → DELETE old index, POST /indexes, PATCH settings
 *                              (waits for task success after every write)
 *   - indexMeili(...)        → POST docs in batches, wait for tasks
 *   - runQueriesMeili(...)   → translate canonical → POST /indexes/<d>/search,
 *                              wrap `process.hrtime.bigint()` around the call only
 *
 * Row schema matches Elastic for CSV/analyzer compatibility:
 *   { query, queryType, repetition, latencyMs, resultCount, status }
 *
 * Meili specifics:
 *   - Tasks: every write returns a taskUid; we poll /tasks/<uid> until status
 *     ∈ {succeeded, failed}. Search timings are unaffected — we only poll
 *     between phases, never during the search phase.
 *   - No `_refresh` — Meili queues tasks and once a task succeeds, docs are
 *     immediately searchable.
 */

const axios = require('axios');
const { toMeili } = require('../queries/translate');

const DEFAULT_MEILI_URL = process.env.MEILI_URL || 'http://localhost:7700';

function nowNs() {
    return process.hrtime.bigint();
}

function msSince(startNs) {
    return Number(process.hrtime.bigint() - startNs) / 1_000_000;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitForTask(taskUid, { meiliUrl = DEFAULT_MEILI_URL, timeoutMs = 1800000 } = {}) {
    const start = Date.now();
    let delay = 50;
    while (Date.now() - start < timeoutMs) {
        const res = await axios.get(`${meiliUrl}/tasks/${taskUid}`, { timeout: 10000 });
        const t = res.data || {};
        if (t.status === 'succeeded') return t;
        if (t.status === 'failed' || t.status === 'canceled') {
            throw new Error(
                `meili task ${taskUid} ${t.status}: ${JSON.stringify(t.error || t)}`,
            );
        }
        await sleep(delay);
        delay = Math.min(2000, delay * 2);
    }
    throw new Error(`meili task ${taskUid} did not complete within ${timeoutMs}ms`);
}

async function setupMeili({ domain, settings, meiliUrl = DEFAULT_MEILI_URL }) {
    const startNs = nowNs();
    // DELETE if exists (Meili returns a task even if the index didn't exist)
    try {
        const del = await axios.delete(`${meiliUrl}/indexes/${domain}`, { timeout: 30000 });
        if (del.data && del.data.taskUid != null) {
            try {
                await waitForTask(del.data.taskUid, { meiliUrl });
            } catch (_e) {
                // ignore — index may not have existed
            }
        }
    } catch (err) {
        const status = err.response && err.response.status;
        if (status !== 404) {
            // 404 is OK; other errors should be ignored at setup-time
            // but we'd rather know than swallow silently
            // continue anyway
        }
    }

    // POST index create
    try {
        const create = await axios.post(
            `${meiliUrl}/indexes`,
            { uid: domain, primaryKey: 'id' },
            { timeout: 30000, headers: { 'Content-Type': 'application/json' } },
        );
        if (create.data && create.data.taskUid != null) {
            await waitForTask(create.data.taskUid, { meiliUrl });
        }
    } catch (err) {
        const body = err.response && err.response.data;
        throw new Error(
            `meili POST /indexes failed: ${err.message} ${body ? JSON.stringify(body) : ''}`,
        );
    }

    // PATCH settings
    if (settings) {
        try {
            const patch = await axios.patch(`${meiliUrl}/indexes/${domain}/settings`, settings, {
                timeout: 30000,
                headers: { 'Content-Type': 'application/json' },
            });
            if (patch.data && patch.data.taskUid != null) {
                await waitForTask(patch.data.taskUid, { meiliUrl });
            }
        } catch (err) {
            const body = err.response && err.response.data;
            throw new Error(
                `meili PATCH /indexes/${domain}/settings failed: ${err.message} ${body ? JSON.stringify(body) : ''}`,
            );
        }
    }

    return { setupMs: msSince(startNs) };
}

async function indexMeili({
    domain,
    docs,
    batchSize = 1000,
    meiliUrl = DEFAULT_MEILI_URL,
    onProgress = null,
}) {
    const startNs = nowNs();
    const total = docs.length;
    const taskUids = [];
    for (let i = 0; i < total; i += batchSize) {
        const batch = docs.slice(i, i + batchSize);
        try {
            const res = await axios.post(
                `${meiliUrl}/indexes/${domain}/documents`,
                batch,
                {
                    timeout: 120000,
                    headers: { 'Content-Type': 'application/json' },
                    maxBodyLength: 200 * 1024 * 1024,
                },
            );
            if (res.data && res.data.taskUid != null) {
                taskUids.push(res.data.taskUid);
            }
        } catch (err) {
            const body = err.response && err.response.data;
            throw new Error(
                `meili POST /indexes/${domain}/documents batch ${i}-${i + batch.length} failed: ${err.message} ${body ? JSON.stringify(body) : ''}`,
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
    // Wait for all submitted tasks to complete before returning
    for (const uid of taskUids) {
        await waitForTask(uid, { meiliUrl });
    }
    return { indexingMs: msSince(startNs), indexed: total };
}

async function searchOnce({ domain, body, meiliUrl = DEFAULT_MEILI_URL }) {
    const start = nowNs();
    let status = 'ok';
    let resultCount = 0;
    try {
        const res = await axios.post(`${meiliUrl}/indexes/${domain}/search`, body, {
            timeout: 60000,
            headers: { 'Content-Type': 'application/json' },
        });
        const hits = res.data && res.data.hits;
        resultCount = Array.isArray(hits) ? hits.length : 0;
    } catch (_err) {
        status = 'error';
    }
    return { latencyMs: msSince(start), status, resultCount };
}

async function runQueriesMeili({
    domain,
    queries,
    reps = 10,
    meiliUrl = DEFAULT_MEILI_URL,
    onProgress = null,
}) {
    const rows = [];
    for (let qi = 0; qi < queries.length; qi++) {
        const canonical = queries[qi];
        const body = toMeili(canonical, domain);
        const queryStr = canonical.tokens || `${canonical.field}${canonical.op || ':'}${canonical.value}`;
        const queryType = canonical.kind === 'text' ? canonical.tokenType : canonical.kind;
        for (let r = 1; r <= reps; r++) {
            const { latencyMs, status, resultCount } = await searchOnce({ domain, body, meiliUrl });
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

async function teardownMeili({ domain, meiliUrl = DEFAULT_MEILI_URL }) {
    try {
        const res = await axios.delete(`${meiliUrl}/indexes/${domain}`, { timeout: 30000 });
        if (res.data && res.data.taskUid != null) {
            try {
                await waitForTask(res.data.taskUid, { meiliUrl });
            } catch (_e) {
                /* ignore */
            }
        }
    } catch (err) {
        const status = err.response && err.response.status;
        if (status !== 404) {
            console.warn(`meili teardown DELETE /${domain} warning: ${err.message}`);
        }
    }
}

module.exports = {
    setupMeili,
    indexMeili,
    runQueriesMeili,
    searchOnce,
    teardownMeili,
    waitForTask,
    DEFAULT_MEILI_URL,
};
