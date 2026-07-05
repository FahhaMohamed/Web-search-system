/**
 * TextIndex — thin JavaScript wrapper around the native Tantivy addon.
 *
 * The class interface (constructor, add, search) is unchanged from the
 * previous pure-JS implementation, so nothing else in search-node/ needs
 * to know we swapped the hot loop out for native Rust code. The heavy
 * work (posting-list intersection, scoring, top-K selection) all happens
 * inside Tantivy — the same library layer Elasticsearch and Solr use via
 * Lucene.
 *
 * Schema initialization is lazy: the first call to add() or search()
 * establishes which text fields exist. This keeps the constructor
 * argument-less, matching how the JS version was called by app.js.
 */

const { NativeTextIndex } = require('./native');

class TextIndex {
    constructor() {
        this._native = null;
        this._fields = null;
    }

    _ensure(fields) {
        if (this._native) return;
        if (!Array.isArray(fields) || fields.length === 0) {
            throw new Error('TextIndex needs at least one field on first use');
        }
        this._native = new NativeTextIndex(fields);
        this._fields = fields.slice();
    }

    add(doc, fields) {
        if (doc == null || doc.id == null) return;
        this._ensure(fields);
        const id = String(doc.id);
        // Only project the fields this index knows about — pass strings
        // through and coerce arrays (e.g., a categories array) into a
        // single joined string so Tantivy tokenizes them as text.
        const projected = {};
        for (const f of this._fields) {
            const v = doc[f];
            if (v == null) continue;
            if (typeof v === 'string') {
                projected[f] = v;
            } else if (Array.isArray(v)) {
                projected[f] = v.filter((x) => typeof x === 'string').join(' ');
            } else {
                projected[f] = String(v);
            }
        }
        this._native.add(id, projected);
    }

    search(query, fields, opts) {
        this._ensure(fields);
        const limit = opts && Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 1000;
        // Tantivy will auto-commit inside its search() if the writer is
        // dirty, so we don't need to call commit() explicitly here.
        return this._native.search(String(query || ''), limit);
    }

    clear() {
        // Full clear = drop the native index and let lazy init rebuild.
        this._native = null;
        this._fields = null;
    }
}

module.exports = { TextIndex };
