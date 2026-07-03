const axios = require('axios');
const httpAgent = require('./httpAgent');

class SchemaClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    async fetch(domain) {
        try {
            const response = await axios.get(`${this.baseUrl}/schema/${domain}`, { timeout: 3000, httpAgent });
            return response.data.schema;
        } catch (err) {
            if (err.response && err.response.status === 404) return null;
            throw err;
        }
    }
}

module.exports = { SchemaClient };
