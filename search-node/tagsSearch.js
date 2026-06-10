const STOP_WORDS = new Set([
    'a', 'an', 'the',
    'and', 'or', 'but',
    'of', 'in', 'on', 'at', 'for', 'with', 'by', 'to', 'from', 'as',
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'this', 'that', 'these', 'those',
]);

const FIELD_VALUE_RE = /^([a-zA-Z_]\w*):(.+)$/;

function tagValues(doc, field) {
    const raw = doc[field];
    if (raw == null) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map(v => String(v).toLowerCase());
}

function tokenize(query) {
    return query.trim().split(/\s+/).filter(Boolean);
}

function tagsSearch(query, docs, fields) {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const fieldSet = new Set(fields);
    const constraints = [];

    for (const token of tokens) {
        const fv = token.match(FIELD_VALUE_RE);
        if (fv) {
            const [, field, value] = fv;
            if (!fieldSet.has(field)) return [];
            constraints.push({ kind: 'explicit', field, value: value.toLowerCase(), weight: 2 });
            continue;
        }

        if (token.startsWith('#') && token.length > 1) {
            constraints.push({ kind: 'any', value: token.slice(1).toLowerCase(), weight: 1.5 });
            continue;
        }

        const lower = token.toLowerCase();
        if (STOP_WORDS.has(lower)) continue;

        constraints.push({ kind: 'any', value: lower, weight: 1 });
    }

    if (constraints.length === 0) return [];

    const results = [];
    for (const doc of docs) {
        let score = 0;
        let allMatch = true;

        for (const c of constraints) {
            let hit = false;
            if (c.kind === 'explicit') {
                hit = tagValues(doc, c.field).includes(c.value);
            } else {
                for (const field of fields) {
                    if (tagValues(doc, field).includes(c.value)) { hit = true; break; }
                }
            }
            if (!hit) { allMatch = false; break; }
            score += c.weight;
        }

        if (allMatch) results.push({ ...doc, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results;
}

module.exports = { tagsSearch };
