const { TopKMinHeap } = require('./heap');

const STOP_WORDS = new Set([
    'a', 'an', 'the',
    'and', 'or', 'but',
    'of', 'in', 'on', 'at', 'for', 'with', 'by', 'to', 'from', 'as',
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'this', 'that', 'these', 'those',
]);

const TITLE_FIELDS = new Set(['title', 'name', 'headline']);

function tokenize(text) {
    return text
        .toLowerCase()
        .split(/\s+/)
        .map(t => t.trim())
        .filter(t => t.length > 0 && !STOP_WORDS.has(t));
}

class TextIndex {
    constructor() {
        // term -> Map<docId, Map<fieldName, count>>
        this.postings = new Map();
        // docId -> Set<term> (for fast removal on re-add)
        this.docTerms = new Map();
    }

    add(doc, fields) {
        const id = doc.id;
        if (id == null) return;
        if (this.docTerms.has(id)) this._remove(id);

        const seenTerms = new Set();
        for (const field of fields) {
            const raw = doc[field];
            if (typeof raw !== 'string') continue;
            const tokens = tokenize(raw);
            for (const term of tokens) {
                let postingsForTerm = this.postings.get(term);
                if (!postingsForTerm) {
                    postingsForTerm = new Map();
                    this.postings.set(term, postingsForTerm);
                }
                let fieldsForDoc = postingsForTerm.get(id);
                if (!fieldsForDoc) {
                    fieldsForDoc = new Map();
                    postingsForTerm.set(id, fieldsForDoc);
                }
                fieldsForDoc.set(field, (fieldsForDoc.get(field) || 0) + 1);
                seenTerms.add(term);
            }
        }
        this.docTerms.set(id, seenTerms);
    }

    _remove(id) {
        const terms = this.docTerms.get(id);
        if (!terms) return;
        for (const term of terms) {
            const postingsForTerm = this.postings.get(term);
            if (!postingsForTerm) continue;
            postingsForTerm.delete(id);
            if (postingsForTerm.size === 0) this.postings.delete(term);
        }
        this.docTerms.delete(id);
    }

    /**
     * Text search over indexed docs.
     *
     * opts.limit (optional): return only the top-limit results.
     *   When set, uses a min-heap of that size instead of sorting the
     *   whole result set — the top-K early-termination optimization.
     *   Big win when the query matches many docs but the caller only
     *   needs the best few (typical for user-facing search).
     *
     * When opts.limit is not set (or undefined), preserves the original
     * "return everything sorted" behavior — kept so existing callers
     * that need the full ranked list are unaffected.
     */
    search(query, fields, opts) {
        const terms = tokenize(query);
        if (terms.length === 0) return [];

        // Multi-term queries accumulate per-doc scores across terms, so
        // we still need to build the score map fully — we don't know a
        // doc's final score until every query term has contributed. The
        // savings come from what we do AFTER the map is built.
        const scores = new Map();
        for (const term of terms) {
            const postingsForTerm = this.postings.get(term);
            if (!postingsForTerm) continue;
            for (const [docId, fieldsForDoc] of postingsForTerm) {
                let docScore = 0;
                for (const field of fields) {
                    const count = fieldsForDoc.get(field);
                    if (!count) continue;
                    const weight = TITLE_FIELDS.has(field) ? 3 : 1;
                    docScore += weight * count;
                }
                if (docScore > 0) {
                    scores.set(docId, (scores.get(docId) || 0) + docScore);
                }
            }
        }

        const limit = opts && Number.isInteger(opts.limit) && opts.limit > 0
            ? opts.limit
            : null;

        // Fast path — caller wants top-K only. Use bounded min-heap:
        //   O(N log K) instead of O(N log N) for a full sort.
        if (limit !== null) {
            const heap = new TopKMinHeap(limit);
            for (const [id, score] of scores) heap.offer(id, score);
            return heap.drainSorted();
        }

        // Legacy path — caller wants everything sorted (kept for
        // backward compatibility).
        const results = [];
        for (const [id, score] of scores) results.push({ id, score });
        results.sort((a, b) => b.score - a.score);
        return results;
    }

    clear() {
        this.postings.clear();
        this.docTerms.clear();
    }
}

module.exports = { TextIndex };
