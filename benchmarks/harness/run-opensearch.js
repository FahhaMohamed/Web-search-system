/**
 * Black-box benchmark runner for OpenSearch.
 *
 * OpenSearch was forked from Elasticsearch 7.10.2 in 2021 and kept the
 * same query DSL, mapping format, and _bulk API. We reuse the Elastic
 * runner directly — the only differences are the default port (9201
 * → 9200 in-container so both engines can run side-by-side) and the
 * translator function name.
 */

const {
    setupElastic,
    indexElastic,
    runQueriesElastic,
    teardownElastic,
    searchOnce,
    buildBulkBody,
} = require('./run-elastic');

const DEFAULT_OS_URL = process.env.OS_URL || 'http://localhost:9201';

// Small shims that flip the default URL from ES's 9200 to OS's 9201
// but otherwise delegate straight through.

function setupOpenSearch({ domain, mapping, osUrl = DEFAULT_OS_URL }) {
    return setupElastic({ domain, mapping, esUrl: osUrl });
}

function indexOpenSearch({ domain, docs, batchSize, osUrl = DEFAULT_OS_URL, onProgress }) {
    return indexElastic({ domain, docs, batchSize, esUrl: osUrl, onProgress });
}

function runQueriesOpenSearch({ domain, queries, reps, osUrl = DEFAULT_OS_URL, onProgress }) {
    return runQueriesElastic({ domain, queries, reps, esUrl: osUrl, onProgress });
}

function teardownOpenSearch({ domain, osUrl = DEFAULT_OS_URL }) {
    return teardownElastic({ domain, esUrl: osUrl });
}

module.exports = {
    setupOpenSearch,
    indexOpenSearch,
    runQueriesOpenSearch,
    teardownOpenSearch,
    searchOnce,
    buildBulkBody,
    DEFAULT_OS_URL,
};
