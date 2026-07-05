const express = require('express');
const cors = require('cors');
const { SearchClient } = require('./searchClient');
const { IndexClient } = require('./indexClient');
const { ShardClient } = require('./shardClient');
const { SchemaClient } = require('./schemaClient');
const { SearchIndexClient } = require('./searchIndexClient');
const { RouteCache } = require('./routeCache');
const { SearchResponseCache } = require('./searchResponseCache');
const { parseQuery: localParseQuery } = require('./routeLocal');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cors());

const SHARD_CLUSTER_URL = process.env.SHARD_CLUSTER_URL || 'http://shard-cluster:7000';
const SCHEMA_REGISTRY_URL = process.env.SCHEMA_REGISTRY_URL || 'http://schema-registry:5000';
const SEARCH_NODE_URLS = {
    text: process.env.TEXT_NODE_URL || 'http://text-node:3001',
    metadata: process.env.METADATA_NODE_URL || 'http://metadata-node:3002',
    tags: process.env.TAGS_NODE_URL || 'http://tags-node:3003',
};

let searchClient = new SearchClient();
let shardClient = new ShardClient(SHARD_CLUSTER_URL);
let schemaClient = new SchemaClient(SCHEMA_REGISTRY_URL);
let searchIndexClient = new SearchIndexClient(SEARCH_NODE_URLS);
let indexClient = new IndexClient({ schemaClient, shardClient, searchIndexClient });
const routeCache = new RouteCache();
const searchResponseCache = new SearchResponseCache();
const schemaCache = new Map();

function setSearchClient(client) { searchClient = client; }
function setIndexClient(client) { indexClient = client; }
function setShardClient(client) { shardClient = client; }
function setSchemaClient(client) { schemaClient = client; }
function setSearchIndexClient(client) { searchIndexClient = client; }

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

    const { domain, query, filters = {}, limit = 20, minConfidence = 0.5 } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query is required' });
    if (!domain) return res.status(400).json({ error: 'domain is required' });
    timings.parseInput = dtMs(t0);

    // ------ Phase 0: full-response cache (Fix H) ------
    //   Skips everything below for repeated queries. Same optimization
    //   Elastic/Solr apply via their built-in request/query caches.
    const cachedBody = searchResponseCache.get(domain, query, filters, limit);
    if (cachedBody) {
        // Send a fresh copy with cache-hit timings so callers can measure.
        const t = { total: dtMs(t0), cacheHit: true };
        return res.json({ ...cachedBody, timestamp: new Date().toISOString(), _timings: t });
    }

    // ------ Phase 1: routing decision ------
    //   Query Splitter logic runs in-process (was a separate service before
    //   Option 1). Two levels of caching:
    //     1. per-query LRU cache (fastest — repeated queries)
    //     2. local parseQuery using the cached schema for this domain
    const tRoute = process.hrtime.bigint();
    let routing = routeCache.get(domain, query);
    let routeSource = 'cache';
    if (!routing) {
        let schema = schemaCache.get(domain);
        if (!schema) {
            try {
                schema = await schemaClient.fetch(domain);
                if (schema) schemaCache.set(domain, schema);
            } catch (err) {
                return res.status(502).json({ error: `Schema fetch failed: ${err.message}` });
            }
        }
        if (!schema) {
            return res.status(404).json({ error: `Domain not found: ${domain}` });
        }
        const local = localParseQuery(query, schema);
        if (local.error) {
            return res.status(400).json({ error: local.error });
        }
        routing = { domain, query, nodes: local.nodes };
        routeSource = 'local';
        routeCache.set(domain, query, routing);
    }
    timings.route = dtMs(tRoute);
    timings.routeCacheHit = routeSource === 'cache';
    timings.routeSource = routeSource;

    // ------ Phase 2: fan-out to search nodes ------
    //   Filter by minConfidence to skip noise nodes (default 0.5). If the
    //   filter would leave zero nodes, keep the top-1 as a safety net so
    //   we never accidentally return empty results for a valid query.
    const tFanout = process.hrtime.bigint();
    const allNodes = routing.nodes || [];
    let nodes = allNodes.filter(n => (n.confidence || 0) >= minConfidence);
    if (nodes.length === 0 && allNodes.length > 0) {
        nodes = [allNodes[0]];
    }
    timings.nodeCount = nodes.length;
    timings.nodesSkipped = allNodes.length - nodes.length;
    const nodeResponses = await Promise.all(nodes.map(async (n) => {
        const out = await searchClient.search(n.name, { domain, query, filters, limit });
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

    // Populate Fix H cache — subsequent identical queries skip everything above.
    // Store WITHOUT _timings/timestamp; those are re-stamped fresh on each hit.
    const bodyForCache = { ...body };
    delete bodyForCache._timings;
    delete bodyForCache.timestamp;
    searchResponseCache.set(domain, query, filters, limit, bodyForCache);

    res.json(body);
});

app.post('/api/index', async (req, res) => {
    const { documents, domain } = req.body || {};
    if (!domain) return res.status(400).json({ error: 'domain is required' });
    if (!Array.isArray(documents)) return res.status(400).json({ error: 'documents array is required' });

    try {
        const result = await indexClient.index(domain, documents);
        // New docs invalidate cached search responses. Simplest correct
        // policy: drop the whole search cache (rebuild on the next query).
        searchResponseCache.clear();
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

module.exports = { app, setSearchClient, setIndexClient, setShardClient, setSchemaClient, setSearchIndexClient };
