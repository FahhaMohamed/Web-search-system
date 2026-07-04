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
}

module.exports = { ShardClient };
