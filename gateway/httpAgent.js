/**
 * Shared HTTP keep-alive agent for internal service-to-service calls.
 *
 * Without this, every axios call opens a fresh TCP connection to the
 * target service (~1 ms wasted per call). Since one user query triggers
 * ~4 internal HTTP calls (Gateway → Specialty → Search Nodes → Shard
 * Cluster), that's ~4 ms of pure connection-setup overhead per query.
 *
 * With keepAlive:true, axios reuses an existing TCP connection from the
 * pool. The pool size (maxSockets) is generous enough that we never
 * bottleneck at our expected concurrency.
 *
 * Internal traffic is plain HTTP, so we only need httpAgent. If any
 * internal call ever moves to HTTPS, add an httpsAgent here as well.
 */

const http = require('http');

module.exports = new http.Agent({
    keepAlive: true,
    maxSockets: 100,
    keepAliveMsecs: 30000,
});
