const axios = require('axios');
const httpAgent = require('./httpAgent');

function parseTarget(url) {
    if (typeof url === 'string' && url.startsWith('unix:')) {
        return { baseURL: 'http://unix', socketPath: url.slice(5) };
    }
    return { baseURL: url, socketPath: null };
}

class ShardClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this._target = parseTarget(baseUrl);
    }

    async batchGet(domain, ids) {
        if (!Array.isArray(ids) || ids.length === 0) return [];
        try {
            const opts = { timeout: 5000, httpAgent };
            if (this._target.socketPath) opts.socketPath = this._target.socketPath;
            const res = await axios.post(
                `${this._target.baseURL}/docs/batch-get`,
                { domain, ids },
                opts
            );
            return res.data.documents || [];
        } catch (_) {
            return [];
        }
    }

    async putDocs(domain, documents) {
        try {
            const opts = { timeout: 300000, httpAgent };
            if (this._target.socketPath) opts.socketPath = this._target.socketPath;
            const res = await axios.put(
                `${this._target.baseURL}/docs`,
                { domain, documents },
                opts
            );
            return { ok: true, stored: res.data.stored, ids: res.data.ids };
        } catch (err) {
            const message = err.response ? (err.response.data && err.response.data.error) || err.message : err.message;
            return { ok: false, error: message };
        }
    }
}

module.exports = { ShardClient };
