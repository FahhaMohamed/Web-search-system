const OPERATOR_TOKEN_RE = /^([a-zA-Z_]\w*)(<=|>=|<|>|=|:)(.+)$/;

const COMPARISON_OPS = {
    under:  '<',
    below:  '<',
    less:   '<',
    over:   '>',
    above:  '>',
    more:   '>',
};

function parseValue(raw) {
    const asNumber = Number(raw);
    if (!Number.isNaN(asNumber) && raw.trim() !== '') return asNumber;
    return String(raw);
}

function compare(actual, op, expected) {
    if (op === '=' || op === ':') {
        if (typeof actual === 'string' && typeof expected === 'string') {
            return actual.toLowerCase() === expected.toLowerCase();
        }
        return actual === expected;
    }
    if (typeof actual !== 'number' || typeof expected !== 'number') return false;
    switch (op) {
        case '<':  return actual <  expected;
        case '<=': return actual <= expected;
        case '>':  return actual >  expected;
        case '>=': return actual >= expected;
        default:   return false;
    }
}

function parseConstraints(query, fields) {
    const fieldSet = new Set(fields);
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    const constraints = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        const opMatch = token.match(OPERATOR_TOKEN_RE);
        if (opMatch) {
            const [, field, op, rawValue] = opMatch;
            if (!fieldSet.has(field)) continue;
            constraints.push({ field, op, value: parseValue(rawValue) });
            continue;
        }

        if (fieldSet.has(token) && i + 2 < tokens.length) {
            const word = tokens[i + 1].toLowerCase();
            const op = COMPARISON_OPS[word];
            if (op && /^\d+(\.\d+)?$/.test(tokens[i + 2])) {
                constraints.push({ field: token, op, value: Number(tokens[i + 2]) });
                i += 2;
            }
        }
    }

    return constraints;
}

function metadataSearch(query, docs, fields) {
    const constraints = parseConstraints(query, fields);
    if (constraints.length === 0) return [];

    const results = [];
    for (const doc of docs) {
        let allMatch = true;
        for (const c of constraints) {
            if (!compare(doc[c.field], c.op, c.value)) {
                allMatch = false;
                break;
            }
        }
        if (allMatch) {
            results.push({ ...doc, score: constraints.length });
        }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
}

module.exports = { metadataSearch, parseConstraints };
