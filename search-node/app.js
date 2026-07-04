const express = require('express');
const path = require('path');
const { DocStore } = require('./docStore');
const { FileStorage } = require('./storage');
const { SchemaClient } = require('./schemaClient');
const { TextIndex } = require('./textIndex');
const { textSearch } = require('./textSearch');
const { metadataSearch } = require('./metadataSearch');
const { tagsSearch } = require('./tagsSearch');
const { msgpackBody, sendBody } = require('./msgpack');

const TEXT_ALGORITHM = process.env.TEXT_ALGORITHM || 'inverted';

const SPECIALTIES = {
    metadata: { run: metadataSearch, schemaKey: 'metadata' },
    tags:     { run: tagsSearch,     schemaKey: 'tags' },
};

function applyFilters(doc, filters) {
    for (const [k, v] of Object.entries(filters || {})) {
        if (doc[k] !== v) return null;
    }
    return doc;
}

function createApp({ specialty, nodeId, schemaClient, docStore }) {
    const state = {
        specialty,
        nodeId,
        schemaClient,
        docStore,
        textIndices: new Map(),
    };
    const app = express();
    app.use(msgpackBody({ limit: 100 * 1024 * 1024 }));
    app.use(express.json({ limit: '50mb' }));

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', service: 'search-node', specialty: state.specialty, nodeId: state.nodeId });
    });

    app.post('/index', async (req, res) => {
        const { documents, domain } = req.body || {};
        if (!domain) return res.status(400).json({ error: 'domain is required' });
        if (!Array.isArray(documents)) return res.status(400).json({ error: 'documents array is required' });

        const ids = [];
        for (const doc of documents) {
            ids.push(state.docStore.put(domain, doc));
        }
        state.docStore.flush();

        if (state.specialty === 'text' && TEXT_ALGORITHM === 'inverted') {
            const schema = await state.schemaClient.fetch(domain);
            const fields = schema && Array.isArray(schema.text) ? schema.text : [];
            if (fields.length > 0) {
                let idx = state.textIndices.get(domain);
                if (!idx) {
                    idx = new TextIndex();
                    state.textIndices.set(domain, idx);
                }
                for (let i = 0; i < documents.length; i++) {
                    idx.add({ ...documents[i], id: ids[i] }, fields);
                }
            }
        }

        sendBody(req, res, { domain, indexed: ids.length, ids, specialty: state.specialty, nodeId: state.nodeId });
    });

    app.post('/search', async (req, res) => {
        const { domain, query, filters = {}, limit } = req.body || {};
        if (!domain) return res.status(400).json({ error: 'domain is required' });
        if (!query && query !== '') return res.status(400).json({ error: 'query is required' });

        const schema = await state.schemaClient.fetch(domain);
        if (!schema) return res.status(404).json({ error: `Domain not found: ${domain}` });

        // Convert incoming limit → topK for the index. When Gateway wants
        // limit=20, we ask the index for a bit more (buffer for filter
        // rejections). No limit → return everything (backward compat).
        const parsedLimit = Number.isInteger(limit) && limit > 0 ? limit : null;
        const indexTopK = parsedLimit ? Math.max(parsedLimit * 2, parsedLimit + 30) : null;

        if (state.specialty === 'text' && TEXT_ALGORITHM === 'inverted') {
            const fields = Array.isArray(schema.text) ? schema.text : [];
            if (fields.length === 0) {
                return sendBody(req, res, { domain, query, specialty: state.specialty, results: [] });
            }
            let idx = state.textIndices.get(domain);
            if (!idx) {
                idx = new TextIndex();
                state.textIndices.set(domain, idx);
                for (const d of state.docStore.list(domain)) idx.add(d, fields);
            }
            const hits = idx.search(query, fields, indexTopK ? { limit: indexTopK } : undefined);
            const results = [];
            for (const h of hits) {
                const doc = state.docStore.get(domain, h.id);
                if (!doc) continue;
                if (!applyFilters(doc, filters)) continue;
                results.push({ id: h.id, score: h.score });
                if (parsedLimit && results.length >= parsedLimit) break;
            }
            return sendBody(req, res, { domain, query, specialty: state.specialty, nodeId: state.nodeId, results });
        }

        if (state.specialty === 'text') {
            const fields = Array.isArray(schema.text) ? schema.text : [];
            if (fields.length === 0) {
                return sendBody(req, res, { domain, query, specialty: state.specialty, results: [] });
            }
            const docs = state.docStore.list(domain);
            const results = textSearch(query, docs, fields)
                .map(r => applyFilters(r, filters))
                .filter(Boolean)
                .map(r => ({ id: r.id, score: r.score }));
            return sendBody(req, res, { domain, query, specialty: state.specialty, nodeId: state.nodeId, results });
        }

        const handler = SPECIALTIES[state.specialty];
        if (!handler) return res.status(500).json({ error: `Unknown specialty: ${state.specialty}` });

        const fields = schema[handler.schemaKey];
        if (!Array.isArray(fields) || fields.length === 0) {
            return sendBody(req, res, { domain, query, specialty: state.specialty, results: [] });
        }

        const docs = state.docStore.list(domain);
        const results = handler.run(query, docs, fields)
            .map(r => applyFilters(r, filters))
            .filter(Boolean)
            .map(r => ({ id: r.id, score: r.score }));

        sendBody(req, res, { domain, query, specialty: state.specialty, nodeId: state.nodeId, results });
    });

    app._state = state;
    return app;
}

function makeDefaultStore(nodeId) {
    const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '../data');
    const filePath = path.join(dataDir, `search-${nodeId}.json`);
    const persistence = new FileStorage(filePath);
    const store = new DocStore(persistence);
    try { store.load(); } catch (_) { /* fresh start */ }
    return store;
}

const SPECIALTY = process.env.NODE_SPECIALTY || 'text';
const NODE_ID = process.env.NODE_ID || `node-${SPECIALTY}`;
const SCHEMA_REGISTRY_URL = process.env.SCHEMA_REGISTRY_URL || 'http://localhost:5000';

const defaultApp = createApp({
    specialty: SPECIALTY,
    nodeId: NODE_ID,
    schemaClient: new SchemaClient(SCHEMA_REGISTRY_URL),
    docStore: makeDefaultStore(NODE_ID),
});

function setSpecialty(s)     { defaultApp._state.specialty = s; defaultApp._state.textIndices.clear(); }
function setSchemaClient(c)  { defaultApp._state.schemaClient = c; defaultApp._state.textIndices.clear(); }
function setDocStore(s)      { defaultApp._state.docStore = s; defaultApp._state.textIndices.clear(); }

const PORT = process.env.PORT || 3001;
const SOCKET_PATH = process.env.SOCKET_PATH;

if (require.main === module) {
    if (SOCKET_PATH) {
        try { require('fs').unlinkSync(SOCKET_PATH); } catch (_e) {}
        const sockServer = defaultApp.listen(SOCKET_PATH, () => {
            try { require('fs').chmodSync(SOCKET_PATH, 0o777); } catch (_e) {}
            console.log(`Search Node (${SPECIALTY}) listening on socket ${SOCKET_PATH}`);
        });
        sockServer.on('error', (e) => console.error(`Search Node (${SPECIALTY}) socket bind FAILED: ${e.code} ${e.message}`));
    }
    defaultApp.listen(PORT, () => {
        console.log(`Search Node (${SPECIALTY}) listening on port ${PORT}`);
    });
}

module.exports = { app: defaultApp, createApp, setSpecialty, setSchemaClient, setDocStore };
