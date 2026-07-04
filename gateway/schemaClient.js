const axios = require('axios');
const httpAgent = require('./httpAgent');
const { unpack, MSGPACK_MIME } = require('./msgpack');

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
            const opts = {
                timeout: 3000,
                httpAgent,
                headers: { 'Accept': MSGPACK_MIME },
                responseType: 'arraybuffer',
            };
            if (this._target.socketPath) opts.socketPath = this._target.socketPath;
            const response = await axios.get(`${this._target.baseURL}/schema/${domain}`, opts);
            const data = unpack(Buffer.from(response.data));
            return data.schema;
        } catch (err) {
            if (err.response && err.response.status === 404) return null;
            throw err;
        }
    }
}

module.exports = { SchemaClient };
