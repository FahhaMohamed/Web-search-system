const axios = require('axios');

class IndexClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    async index(domain, documents) {
        try {
            const res = await axios.post(`${this.baseUrl}/index`, { domain, documents }, { timeout: 600000 });
            return res.data;
        } catch (err) {
            if (err.response) {
                const e = new Error((err.response.data && err.response.data.error) || err.message);
                e.status = err.response.status;
                throw e;
            }
            throw err;
        }
    }
}

module.exports = { IndexClient };
