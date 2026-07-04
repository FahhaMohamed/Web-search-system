const express = require('express');
const cors = require('cors');
const { SpecialtyClient } = require('./specialtyClient');
const { SearchClient } = require('./searchClient');
const { IndexClient } = require('./indexClient');
const { ShardClient } = require('./shardClient');
const { RouteCache } = require('./routeCache');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cors());

const SPECIALTY_NODE_URL = process.env.SPECIALTY_NODE_URL || 'http://specialty-node:6000';
const INDEX_NODE_URL = process.env.INDEX_NODE_URL || 'http://index-node-1:4001';
const SHARD_CLUSTER_URL = process.env.SHARD_CLUSTER_URL || 'http://shard-cluster:7000';

let specialtyClient = new SpecialtyClient(SPECIALTY_NODE_URL);
let searchClient = new SearchClient();
let indexClient = new IndexClient(INDEX_NODE_URL);
let shardClient = new ShardClient(SHARD_CLUSTER_URL);
const routeCache = new RouteCache();

function setSpecialtyClient(client) { specialtyClient = client; }
function setSearchClient(client) { searchClient = client; }
function setIndexClient(client) { indexClient = client; }
function setShardClient(client) { shardClient = client; }

function mergeResults(nodeResults) {
    const merged = new Map();
    for (const nr of nodeResults) {
        if (!nr.results) continue;
        for (const r of nr.results) {
            const key = r.id || r.url || r.title;
            if (!key) continue;
            const weighted = (r.score || 0) * (nr.confidence || 1);
            if (merged.has(key)) {
                const existing = merged.get(key);
                existing.score += weighted;
                existing.sources.push(nr.nodeName);
            } else {
                merged.set(key, {
                    ...r,
                    score: weighted,
                    sources: [nr.nodeName],
                });
            }
        }
    }
    return Array.from(merged.values()).sort((a, b) => b.score - a.score).slice(0, 50);
}

app.post('/api/search', async (req, res) => {
    const t0 = process.hrtime.bigint();
    const dtMs = (from) => Number(process.hrtime.bigint() - from) / 1_000_000;
    const timings = {};

    const { domain, query, filters = {}, limit = 20, minConfidence = 0 } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query is required' });
    if (!domain) return res.status(400).json({ error: 'domain is required' });
    timings.parseInput = dtMs(t0);

    // ------ Phase 1: routing decision (cache hit or Specialty Node call) ------
    const tRoute = process.hrtime.bigint();
    let routing = routeCache.get(domain, query);
    const cacheHit = routing != null;
    if (!routing) {
        try {
            routing = await specialtyClient.route(domain, query);
        } catch (err) {
            const status = err.status || 500;
            return res.status(status).json({ error: err.message });
        }
        routeCache.set(domain, query, routing);
    }
    timings.route = dtMs(tRoute);
    timings.routeCacheHit = cacheHit;

    // ------ Phase 2: fan-out to search nodes ------
    const tFanout = process.hrtime.bigint();
    const nodes = (routing.nodes || []).filter(n => (n.confidence || 0) >= minConfidence);
    timings.nodeCount = nodes.length;
    const nodeResponses = await Promise.all(nodes.map(async (n) => {
        const out = await searchClient.search(n.name, { domain, query, filters });
        return {
            nodeName: n.name,
            confidence: n.confidence,
            results: out.results || [],
            error: out.error,
        };
    }));
    timings.fanout = dtMs(tFanout);

    // ------ Phase 3: merge results ------
    const tMerge = process.hrtime.bigint();
    const finalResults = mergeResults(nodeResponses);
    const topK = finalResults.slice(0, limit);
    timings.merge = dtMs(tMerge);

    // ------ Phase 4: late-hydrate full docs from shard cluster ------
    const tHydrate = process.hrtime.bigint();
    const ids = topK.map(r => r.id).filter(Boolean);
    const fullDocs = await shardClient.batchGet(domain, ids);
    const byId = new Map(fullDocs.map(d => [d.id, d]));
    const hydrated = topK.map(r => {
        const doc = byId.get(r.id);
        return doc ? { ...doc, score: r.score, sources: r.sources } : r;
    });
    timings.hydrate = dtMs(tHydrate);
    timings.hydrateIds = ids.length;

    // ------ Phase 5: shape response ------
    const tShape = process.hrtime.bigint();
    const body = {
        query,
        domain,
        totalResults: finalResults.length,
        results: hydrated,
        routing: nodes,
        searchNodes: nodeResponses.map(nr => ({
            nodeName: nr.nodeName,
            confidence: nr.confidence,
            resultCount: nr.results.length,
            error: nr.error,
        })),
        timestamp: new Date().toISOString(),
        _timings: timings,
    };
    timings.shape = dtMs(tShape);
    timings.total = dtMs(t0);
    res.json(body);
});

app.post('/api/index', async (req, res) => {
    const { documents, domain } = req.body || {};
    if (!domain) return res.status(400).json({ error: 'domain is required' });
    if (!Array.isArray(documents)) return res.status(400).json({ error: 'documents array is required' });

    try {
        const result = await indexClient.index(domain, documents);
        res.json(result);
    } catch (err) {
        const status = err.status || 500;
        res.status(status).json({ error: err.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'gateway' });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Gateway service running on port ${PORT}`);
    });
}

module.exports = { app, setSpecialtyClient, setSearchClient, setIndexClient, setShardClient };
