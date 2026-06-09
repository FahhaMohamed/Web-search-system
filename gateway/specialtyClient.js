const axios = require('axios');

class SpecialtyClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    async route(domain, query) {
        try {
            const res = await axios.post(`${this.baseUrl}/route`, { domain, query }, { timeout: 3000 });
            return res.data;
        } catch (err) {
            if (err.response) {
                const e = new Error(err.response.data && err.response.data.error || 'Specialty error');
                e.status = err.response.status;
                throw e;
            }
            throw err;
        }
    }
}

module.exports = { SpecialtyClient };
