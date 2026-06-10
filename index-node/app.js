const express = require('express');
const { SchemaClient } = require('./schemaClient');
const { IndexClient } = require('./indexClient');

function createApp({ nodeId, schemaClient, indexClient }) {
    const state = { nodeId, schemaClient, indexClient };
    const app = express();
    app.use(express.json());

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', service: 'index-node', nodeId: state.nodeId });
    });

    app.post('/index', async (req, res) => {
        const { domain, documents } = req.body || {};
        if (!domain) return res.status(400).json({ error: 'domain is required' });
        if (!Array.isArray(documents)) return res.status(400).json({ error: 'documents array is required' });
        if (documents.length === 0) return res.status(400).json({ error: 'documents array is empty' });

        const schema = await state.schemaClient.fetch(domain);
        if (!schema) return res.status(404).json({ error: `Domain not registered: ${domain}` });

        const searchNodes = await state.indexClient.fanOut(domain, documents);

        res.json({
            domain,
            received: documents.length,
            nodeId: state.nodeId,
            searchNodes,
        });
    });

    app._state = state;
    return app;
}

const NODE_ID = process.env.NODE_ID || 'index-1';
const SCHEMA_REGISTRY_URL = process.env.SCHEMA_REGISTRY_URL || 'http://localhost:5000';
const SEARCH_NODE_URLS = {
    text: process.env.TEXT_NODE_URL || 'http://search-node-1:3001',
    metadata: process.env.METADATA_NODE_URL || 'http://search-node-2:3002',
    tags: process.env.TAGS_NODE_URL || 'http://search-node-3:3003',
};

const defaultApp = createApp({
    nodeId: NODE_ID,
    schemaClient: new SchemaClient(SCHEMA_REGISTRY_URL),
    indexClient: new IndexClient(SEARCH_NODE_URLS),
});

function setSchemaClient(c) { defaultApp._state.schemaClient = c; }
function setIndexClient(c) { defaultApp._state.indexClient = c; }

const PORT = process.env.PORT || 4001;

if (require.main === module) {
    defaultApp.listen(PORT, () => {
        console.log(`Index Node (${NODE_ID}) listening on port ${PORT}`);
    });
}

module.exports = { app: defaultApp, createApp, setSchemaClient, setIndexClient };
