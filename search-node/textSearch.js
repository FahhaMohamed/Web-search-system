const STOP_WORDS = new Set([
    'a', 'an', 'the',
    'and', 'or', 'but',
    'of', 'in', 'on', 'at', 'for', 'with', 'by', 'to', 'from', 'as',
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'this', 'that', 'these', 'those',
]);

const TITLE_FIELDS = new Set(['title', 'name', 'headline']);

function tokenize(query) {
    return query
        .toLowerCase()
        .split(/\s+/)
        .map(t => t.trim())
        .filter(t => t.length > 0 && !STOP_WORDS.has(t));
}

function textSearch(query, docs, fields) {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const results = [];

    for (const doc of docs) {
        let score = 0;
        for (const field of fields) {
            const raw = doc[field];
            if (typeof raw !== 'string') continue;
            const lower = raw.toLowerCase();
            const weight = TITLE_FIELDS.has(field) ? 3 : 1;
            for (const term of terms) {
                if (lower.includes(term)) score += weight;
            }
        }
        if (score > 0) results.push({ ...doc, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results;
}

module.exports = { textSearch };
