class DocStore {
    constructor(persistence = null) {
        this.byDomain = new Map();
        this.persistence = persistence;
        this._idSeq = 0;
    }

    _generateId() {
        this._idSeq += 1;
        return `doc_${Date.now()}_${this._idSeq}`;
    }

    put(domain, doc) {
        const id = doc.id || this._generateId();
        const stored = { ...doc, id };
        if (!this.byDomain.has(domain)) {
            this.byDomain.set(domain, new Map());
        }
        this.byDomain.get(domain).set(id, stored);
        return id;
    }

    get(domain, id) {
        const bucket = this.byDomain.get(domain);
        if (!bucket) return null;
        return bucket.get(id) || null;
    }

    list(domain) {
        const bucket = this.byDomain.get(domain);
        if (!bucket) return [];
        return Array.from(bucket.values());
    }

    domains() {
        return Array.from(this.byDomain.keys());
    }

    flush() {
        if (!this.persistence) return;
        const out = {};
        for (const [domain, bucket] of this.byDomain.entries()) {
            out[domain] = Array.from(bucket.values());
        }
        this.persistence.write(out);
    }

    load() {
        if (!this.persistence) return;
        const blob = this.persistence.read() || {};
        this.byDomain.clear();
        for (const [domain, docs] of Object.entries(blob)) {
            const bucket = new Map();
            for (const doc of docs) bucket.set(doc.id, doc);
            this.byDomain.set(domain, bucket);
        }
    }
}

module.exports = { DocStore };
