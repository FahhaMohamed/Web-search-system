const axios = require('axios');

class IndexClient {
    constructor(urls) {
        this.urls = urls;
    }

    async fanOut(domain, documents) {
        const entries = Object.entries(this.urls);
        return Promise.all(entries.map(async ([node, url]) => {
            try {
                const res = await axios.post(`${url}/index`, { domain, documents }, { timeout: 5000 });
                return { node, ok: true, indexed: res.data.indexed, nodeId: res.data.nodeId };
            } catch (err) {
                const status = err.response ? err.response.status : undefined;
                const message = err.response ? (err.response.data && err.response.data.error) || err.message : err.message;
                return { node, ok: false, status, error: message };
            }
        }));
    }
}

module.exports = { IndexClient };
