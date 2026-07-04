const axios = require('axios');
const httpAgent = require('./httpAgent');

function parseTarget(url) {
    if (typeof url === 'string' && url.startsWith('unix:')) {
        return { baseURL: 'http://unix', socketPath: url.slice(5) };
    }
    return { baseURL: url, socketPath: null };
}

class SchemaClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this._target = parseTarget(baseUrl);
    }

    async fetch(domain) {
        try {
            //http://localhost:5000/schema/domain
            const opts = { httpAgent };
            if (this._target.socketPath) opts.socketPath = this._target.socketPath;
            const response = await axios.get(`${this._target.baseURL}/schema/${domain}`, opts);
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
