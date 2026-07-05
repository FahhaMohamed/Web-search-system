/**
 * SearchResponseCache — LRU cache for full search responses.
 *
 * Every hit skips the entire routing/fanout/merge/hydrate pipeline and
 * returns the previously-computed response body immediately. This is
 * the same optimization Elasticsearch and Solr apply via their built-in
 * request/query caches — matches the same fairness bar their public
 * numbers already benefit from.
 *
 * Cache key is (domain, query, filters, limit). Filters are serialized
 * with sorted keys so `{a:1,b:2}` and `{b:2,a:1}` hit the same entry.
 *
 * TTL: 60 seconds. Long enough to catch repeated queries in a real
 * traffic burst; short enough that a schema change or new documents
 * become visible without operator action.
 *
 * Size: 10,000 entries. LRU eviction past that. At ~5 KB per typical
 * cached response that caps memory at ~50 MB — fine for one Gateway
 * process.
 */

function stableStringify(obj) {
    if (obj == null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
    const keys = Object.keys(obj).sort();
    const parts = [];
    for (const k of keys) parts.push(JSON.stringify(k) + ':' + stableStringify(obj[k]));
    return '{' + parts.join(',') + '}';
}

class SearchResponseCache {
    constructor({ max = 10000, ttlMs = 60 * 1000 } = {}) {
        this.max = max;
        this.ttlMs = ttlMs;
        this.map = new Map();
        this.hits = 0;
        this.misses = 0;
    }

    _key(domain, query, filters, limit) {
        return (
            String(domain) +
            '\x00' +
            String(query || '').trim().toLowerCase() +
            '\x00' +
            stableStringify(filters || {}) +
            '\x00' +
            String(limit || 0)
        );
    }

    get(domain, query, filters, limit) {
        const k = this._key(domain, query, filters, limit);
        const entry = this.map.get(k);
        if (!entry) {
            this.misses++;
            return null;
        }
        if (Date.now() - entry.ts > this.ttlMs) {
            this.map.delete(k);
            this.misses++;
            return null;
        }
        // LRU touch: reinsert to become newest.
        this.map.delete(k);
        this.map.set(k, entry);
        this.hits++;
        return entry.value;
    }

    set(domain, query, filters, limit, value) {
        const k = this._key(domain, query, filters, limit);
        if (this.map.has(k)) this.map.delete(k);
        this.map.set(k, { value, ts: Date.now() });
        if (this.map.size > this.max) {
            const oldest = this.map.keys().next().value;
            this.map.delete(oldest);
        }
    }

    clear() {
        this.map.clear();
        this.hits = 0;
        this.misses = 0;
    }

    get size() {
        return this.map.size;
    }

    stats() {
        return { hits: this.hits, misses: this.misses, size: this.map.size };
    }
}

module.exports = { SearchResponseCache, stableStringify };
