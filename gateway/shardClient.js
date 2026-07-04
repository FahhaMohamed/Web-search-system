const axios = require('axios');
const httpAgent = require('./httpAgent');
const { pack, unpack, MSGPACK_MIME } = require('./msgpack');

function parseTarget(url) {
    if (typeof url === 'string' && url.startsWith('unix:')) {
        return { baseURL: 'http://unix', socketPath: url.slice(5) };
    }
    return { baseURL: url, socketPath: null };
}

class ShardClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this._target = parseTarget(baseUrl);
    }

    async batchGet(domain, ids) {
        if (!Array.isArray(ids) || ids.length === 0) return [];
        try {
            const opts = {
                timeout: 5000,
                httpAgent,
                headers: { 'Content-Type': MSGPACK_MIME, 'Accept': MSGPACK_MIME },
                responseType: 'arraybuffer',
            };
            if (this._target.socketPath) opts.socketPath = this._target.socketPath;
            const res = await axios.post(
                `${this._target.baseURL}/docs/batch-get`,
                pack({ domain, ids }),
                opts
            );
            const data = unpack(Buffer.from(res.data));
            return data.documents || [];
        } catch (_) {
            return [];
        }
    }

    async putDocs(domain, documents) {
        try {
            const opts = {
                timeout: 300000,
                httpAgent,
                headers: { 'Content-Type': MSGPACK_MIME, 'Accept': MSGPACK_MIME },
                responseType: 'arraybuffer',
            };
            if (this._target.socketPath) opts.socketPath = this._target.socketPath;
            const res = await axios.put(
                `${this._target.baseURL}/docs`,
                pack({ domain, documents }),
                opts
            );
            const data = unpack(Buffer.from(res.data));
            return { ok: true, stored: data.stored, ids: data.ids };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }
}

module.exports = { ShardClient };
