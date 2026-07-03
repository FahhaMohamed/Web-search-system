const axios = require('axios');
const httpAgent = require('./httpAgent');

class ShardClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    async batchGet(domain, ids) {
        if (!Array.isArray(ids) || ids.length === 0) return [];
        try {
            const res = await axios.post(
                `${this.baseUrl}/docs/batch-get`,
                { domain, ids },
                { timeout: 5000, httpAgent }
            );
            return res.data.documents || [];
        } catch (_) {
            return [];
        }
    }
}

module.exports = { ShardClient };
