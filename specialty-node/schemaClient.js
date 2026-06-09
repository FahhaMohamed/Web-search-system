const axios = require('axios');

class SchemaClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    async fetch(domain) {
        try {
            const response = await axios.get(`${this.baseUrl}/schema/${domain}`);
            return response.data.schema;
        } catch (err) {
            if (err.response && err.response.status === 404) {
                return null;
            }
            throw err;
        }
    }
}

module.exports = { SchemaClient };
