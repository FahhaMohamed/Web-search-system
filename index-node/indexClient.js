const axios = require('axios');

function projectDocs(documents, fields) {
    return documents.map(doc => {
        const out = { id: doc.id };
        for (const f of fields) {
            if (f in doc) out[f] = doc[f];
        }
        return out;
    });
}

class IndexClient {
    constructor(urls) {
        this.urls = urls;
    }

    async fanOut(domain, documents, schema) {
        const entries = Object.entries(this.urls);
        return Promise.all(entries.map(async ([node, url]) => {
            const fields = (schema && Array.isArray(schema[node])) ? schema[node] : [];
            const projected = projectDocs(documents, fields);
            try {
                const res = await axios.post(`${url}/index`, { domain, documents: projected }, { timeout: 300000 });
                return { node, ok: true, indexed: res.data.indexed, nodeId: res.data.nodeId };
            } catch (err) {
                const status = err.response ? err.response.status : undefined;
                const message = err.response ? (err.response.data && err.response.data.error) || err.message : err.message;
                return { node, ok: false, status, error: message };
            }
        }));
    }
}

module.exports = { IndexClient, projectDocs };
