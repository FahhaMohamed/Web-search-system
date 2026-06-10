const express = require('express');
const path = require('path');
const { ShardStore } = require('./storage');

function createApp({ nodeId, store }) {
    const state = { nodeId, store };
    const app = express();
    app.use(express.json({ limit: '10mb' }));

    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            service: 'shard-cluster',
            nodeId: state.nodeId,
            shardCount: state.store.shardCount,
        });
    });

    app.put('/docs', (req, res) => {
        const { domain, documents } = req.body || {};
        if (!domain) return res.status(400).json({ error: 'domain is required' });
        if (!Array.isArray(documents)) return res.status(400).json({ error: 'documents array is required' });

        const ids = [];
        for (const doc of documents) {
            ids.push(state.store.put(domain, doc));
        }
        res.json({ domain, stored: ids.length, ids, nodeId: state.nodeId });
    });

    app.post('/docs/batch-get', (req, res) => {
        const { domain, ids } = req.body || {};
        if (!domain) return res.status(400).json({ error: 'domain is required' });
        if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array is required' });

        const documents = state.store.batchGet(domain, ids);
        res.json({ domain, documents, nodeId: state.nodeId });
    });

    app._state = state;
    return app;
}

function makeDefaultStore() {
    const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '../data/shards');
    const shardCount = parseInt(process.env.SHARD_COUNT, 10) || 4;
    const store = new ShardStore({ shardCount, baseDir: dataDir });
    try { store.load(); } catch (_) { /* fresh start */ }
    return store;
}

const NODE_ID = process.env.NODE_ID || 'shard-cluster';
const PORT = process.env.PORT || 7000;

const defaultApp = createApp({ nodeId: NODE_ID, store: makeDefaultStore() });

if (require.main === module) {
    defaultApp.listen(PORT, () => {
        console.log(`Shard Cluster listening on port ${PORT}`);
    });
}

module.exports = { app: defaultApp, createApp };
