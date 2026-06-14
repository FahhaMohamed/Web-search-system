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

    search(query, fields) {
        const terms = tokenize(query);
        if (terms.length === 0) return [];

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
