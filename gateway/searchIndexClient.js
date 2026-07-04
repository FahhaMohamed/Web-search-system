const axios = require('axios');
const httpAgent = require('./httpAgent');
const { pack, unpack, MSGPACK_MIME } = require('./msgpack');

function parseTarget(url) {
    if (typeof url === 'string' && url.startsWith('unix:')) {
        return { baseURL: 'http://unix', socketPath: url.slice(5) };
    }
    return { baseURL: url, socketPath: null };
}

function projectDocs(documents, fields) {
    return documents.map(doc => {
        const out = { id: doc.id };
        for (const f of fields) {
            if (f in doc) out[f] = doc[f];
        }
        return out;
    });
}

class SearchIndexClient {
    constructor(urls) {
        this.urls = urls;
        this._targets = {};
        for (const [k, v] of Object.entries(urls)) this._targets[k] = parseTarget(v);
    }

    async fanOut(domain, documents, schema) {
        const entries = Object.entries(this._targets);
        return Promise.all(entries.map(async ([node, target]) => {
            const fields = (schema && Array.isArray(schema[node])) ? schema[node] : [];
            const projected = projectDocs(documents, fields);
            try {
                const opts = {
                    timeout: 300000,
                    httpAgent,
                    headers: { 'Content-Type': MSGPACK_MIME, 'Accept': MSGPACK_MIME },
                    responseType: 'arraybuffer',
                };
                if (target.socketPath) opts.socketPath = target.socketPath;
                const res = await axios.post(`${target.baseURL}/index`, pack({ domain, documents: projected }), opts);
                const data = unpack(Buffer.from(res.data));
                return { node, ok: true, indexed: data.indexed, nodeId: data.nodeId };
            } catch (err) {
                const status = err.response ? err.response.status : undefined;
                const message = err.message;
                return { node, ok: false, status, error: message };
            }
        }));
    }
}

module.exports = { SearchIndexClient, projectDocs };
