const axios = require('axios');
const httpAgent = require('./httpAgent');

function parseTarget(url) {
    if (typeof url === 'string' && url.startsWith('unix:')) {
        return { baseURL: 'http://unix', socketPath: url.slice(5) };
    }
    return { baseURL: url, socketPath: null };
}

class SpecialtyClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this._target = parseTarget(baseUrl);
    }

    async route(domain, query) {
        try {
            const opts = { timeout: 3000, httpAgent };
            if (this._target.socketPath) opts.socketPath = this._target.socketPath;
            const res = await axios.post(`${this._target.baseURL}/route`, { domain, query }, opts);
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
