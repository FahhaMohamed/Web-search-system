/**
 * In-memory LRU cache for Specialty Node routing decisions.
 *
 * Every user search normally does:
 *   1. Gateway → Specialty Node ("which search nodes for this query?")
 *   2. Gateway → those Search Nodes
 *
 * Step 1's answer is deterministic for a given (domain, query) pair as long
 * as the domain's schema hasn't changed. Repeated searches for the same
 * pattern (which is the common case in real traffic) can skip step 1
 * entirely by reading from this cache.
 *
 * TTL: 5 minutes. Long enough that a busy pattern stays cached across
 * many requests; short enough that a schema-registry update propagates
 * without an operator intervening.
 *
 * Size: 5,000 entries (~ 50 KB of memory). LRU eviction kicks in past
 * that — good enough for one Gateway instance, no coordination needed.
 */

class RouteCache {
    constructor({ max = 5000, ttlMs = 5 * 60 * 1000 } = {}) {
        this.max = max;
        this.ttlMs = ttlMs;
        this.map = new Map();
    }

    _key(domain, query) {
        return String(domain) + ':' + String(query || '').trim().toLowerCase();
    }

    get(domain, query) {
        const k = this._key(domain, query);
        const entry = this.map.get(k);
        if (!entry) return null;
        if (Date.now() - entry.ts > this.ttlMs) {
            this.map.delete(k);
            return null;
        }
        // LRU touch: reinsert to become the newest
        this.map.delete(k);
        this.map.set(k, entry);
        return entry.value;
    }

    set(domain, query, value) {
        const k = this._key(domain, query);
        if (this.map.has(k)) this.map.delete(k);
        this.map.set(k, { value, ts: Date.now() });
        if (this.map.size > this.max) {
            const oldest = this.map.keys().next().value;
            this.map.delete(oldest);
        }
    }

    clear() {
        this.map.clear();
    }

    get size() {
        return this.map.size;
    }
}

module.exports = { RouteCache };
