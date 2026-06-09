const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { SpecialtyClient } = require('./specialtyClient');
const { SearchClient } = require('./searchClient');

const app = express();
app.use(express.json());
app.use(cors());

const SPECIALTY_NODE_URL = process.env.SPECIALTY_NODE_URL || 'http://specialty-node:6000';
let specialtyClient = new SpecialtyClient(SPECIALTY_NODE_URL);
let searchClient = new SearchClient();

function setSpecialtyClient(client) { specialtyClient = client; }
function setSearchClient(client) { searchClient = client; }

const INDEX_NODES = [
    { id: 'index1', url: process.env.INDEX_NODE_1_URL || 'http://index-node-1:4001' },
    { id: 'index2', url: process.env.INDEX_NODE_2_URL || 'http://index-node-2:4002' },
];

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
    const { domain, query, filters = {}, limit = 20, minConfidence = 0 } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query is required' });
    if (!domain) return res.status(400).json({ error: 'domain is required' });

    let routing;
    try {
        routing = await specialtyClient.route(domain, query);
    } catch (err) {
        const status = err.status || 500;
        return res.status(status).json({ error: err.message });
    }

    const nodes = (routing.nodes || []).filter(n => (n.confidence || 0) >= minConfidence);
    const nodeResponses = await Promise.all(nodes.map(async (n) => {
        const out = await searchClient.search(n.name, { domain, query, filters });
        return {
            nodeName: n.name,
            confidence: n.confidence,
            results: out.results || [],
            error: out.error,
        };
    }));

    const finalResults = mergeResults(nodeResponses);
    res.json({
        query,
        domain,
        totalResults: finalResults.length,
        results: finalResults.slice(0, limit),
        routing: nodes,
        searchNodes: nodeResponses.map(nr => ({
            nodeName: nr.nodeName,
            confidence: nr.confidence,
            resultCount: nr.results.length,
            error: nr.error,
        })),
        timestamp: new Date().toISOString(),
    });
});

app.post('/api/index', async (req, res) => {
    try {
        const { documents, domain } = req.body || {};
        if (!documents || !Array.isArray(documents)) {
            return res.status(400).json({ error: 'Documents array is required' });
        }
        const chunkSize = Math.ceil(documents.length / INDEX_NODES.length);
        const indexPromises = INDEX_NODES.map(async (node, index) => {
            const chunk = documents.slice(index * chunkSize, (index + 1) * chunkSize);
            if (chunk.length === 0) return { nodeId: node.id, indexed: 0 };
            try {
                await axios.post(`${node.url}/index`, { documents: chunk, domain });
                return { nodeId: node.id, indexed: chunk.length, success: true };
            } catch (error) {
                return { nodeId: node.id, indexed: 0, error: error.message };
            }
        });
        const indexResults = await Promise.all(indexPromises);
        const totalIndexed = indexResults.reduce((s, r) => s + (r.indexed || 0), 0);
        res.json({
            message: 'Indexing completed',
            domain,
            totalDocuments: documents.length,
            totalIndexed,
            indexNodes: indexResults,
        });
    } catch (error) {
        res.status(500).json({ error: 'Indexing failed', details: error.message });
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

module.exports = { app, setSpecialtyClient, setSearchClient };
