const axios = require('axios');
const httpAgent = require('./httpAgent');

class ShardClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    async putDocs(domain, documents) {
        try {
            const res = await axios.put(
                `${this.baseUrl}/docs`,
                { domain, documents },
                { timeout: 300000, httpAgent }
            );
            return { ok: true, stored: res.data.stored, ids: res.data.ids };
        } catch (err) {
            const message = err.response ? (err.response.data && err.response.data.error) || err.message : err.message;
            return { ok: false, error: message };
        }
    }
}

module.exports = { ShardClient };
