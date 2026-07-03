/**
 * Shared HTTP keep-alive agent for Search Node → Schema Registry calls.
 * See gateway/httpAgent.js for the design note.
 */

const http = require('http');

module.exports = new http.Agent({
    keepAlive: true,
    maxSockets: 100,
    keepAliveMsecs: 30000,
});
