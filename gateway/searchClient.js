const axios = require('axios');
const httpAgent = require('./httpAgent');

const NODE_URLS = {
    text: process.env.TEXT_NODE_URL || 'http://search-node-1:3001',
    metadata: process.env.METADATA_NODE_URL || 'http://search-node-2:3002',
    tags: process.env.TAGS_NODE_URL || 'http://search-node-3:3003',
};

class SearchClient {
    constructor(urls) {
        this.urls = urls || NODE_URLS;
    }

    async search(nodeName, { domain, query, filters }) {
        const url = this.urls[nodeName];
        if (!url) return { results: [] };
        try {
            const res = await axios.post(`${url}/search`, { domain, query, filters }, { timeout: 5000, httpAgent });
            return { results: res.data.results || [] };
        } catch (err) {
            return { results: [], error: err.message };
        }
    }
}

module.exports = { SearchClient, NODE_URLS };
