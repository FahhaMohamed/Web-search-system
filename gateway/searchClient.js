const axios = require('axios');
const httpAgent = require('./httpAgent');

const NODE_URLS = {
    text: process.env.TEXT_NODE_URL || 'http://search-node-1:3001',
    metadata: process.env.METADATA_NODE_URL || 'http://search-node-2:3002',
    tags: process.env.TAGS_NODE_URL || 'http://search-node-3:3003',
};

function parseTarget(url) {
    if (typeof url === 'string' && url.startsWith('unix:')) {
        return { baseURL: 'http://unix', socketPath: url.slice(5) };
    }
    return { baseURL: url, socketPath: null };
}

class SearchClient {
    constructor(urls) {
        this.urls = urls || NODE_URLS;
        this._targets = {};
        for (const [k, v] of Object.entries(this.urls)) this._targets[k] = parseTarget(v);
    }

    async search(nodeName, { domain, query, filters, limit }) {
        const target = this._targets[nodeName];
        if (!target) return { results: [] };
        try {
            const body = { domain, query, filters };
            if (Number.isInteger(limit) && limit > 0) body.limit = limit;
            const opts = { timeout: 5000, httpAgent };
            if (target.socketPath) opts.socketPath = target.socketPath;
            const res = await axios.post(`${target.baseURL}/search`, body, opts);
            return { results: res.data.results || [] };
        } catch (err) {
            return { results: [], error: err.message };
        }
    }
}

module.exports = { SearchClient, NODE_URLS };
