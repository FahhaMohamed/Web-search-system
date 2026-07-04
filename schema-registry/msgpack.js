/**
 * MessagePack transport helpers.
 *
 * Internal services (Gateway ↔ Search Nodes ↔ Shard Cluster ↔ Schema
 * Registry) exchange bodies as MessagePack instead of JSON. Binary
 * format → smaller wire size and 30–50% faster encode/decode than
 * JSON on Node.
 *
 * External endpoints (client → Gateway) stay JSON since browsers and
 * external clients don't speak MessagePack.
 */

const { pack, unpack } = require('msgpackr');

const MSGPACK_MIME = 'application/x-msgpack';

function isMsgpackRequest(headers) {
    return String(headers['content-type'] || '').includes(MSGPACK_MIME);
}

function acceptsMsgpack(headers) {
    return String(headers['accept'] || '').includes(MSGPACK_MIME);
}

// Express middleware: if Content-Type is msgpack, decode the body and
// populate req.body. Otherwise pass through so express.json() can run.
function msgpackBody({ limit = 100 * 1024 * 1024 } = {}) {
    return (req, res, next) => {
        if (!isMsgpackRequest(req.headers)) return next();
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) {
                res.status(413).json({ error: 'body too large' });
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => {
            try {
                req.body = unpack(Buffer.concat(chunks));
                next();
            } catch (err) {
                res.status(400).json({ error: 'invalid msgpack body: ' + err.message });
            }
        });
        req.on('error', (err) => {
            res.status(400).json({ error: 'read error: ' + err.message });
        });
    };
}

// Send a response as msgpack if the client asked for it (Accept
// header), otherwise fall back to JSON.
function sendBody(req, res, body) {
    if (acceptsMsgpack(req.headers)) {
        res.set('Content-Type', MSGPACK_MIME);
        return res.send(pack(body));
    }
    return res.json(body);
}

module.exports = { pack, unpack, MSGPACK_MIME, msgpackBody, sendBody, isMsgpackRequest, acceptsMsgpack };
