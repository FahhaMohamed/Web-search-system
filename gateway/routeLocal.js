/**
 * Local mirror of the Specialty Node's parseQuery logic.
 *
 * Kept in the Gateway so a search request doesn't have to make a network
 * round trip to the Specialty Node just to decide which Search Nodes to
 * call. The Specialty Node still owns this logic as source of truth; if
 * this local parser errors, the caller falls back to the remote call.
 *
 * IMPORTANT: keep in sync with specialty-node/app.js — the two must
 * produce identical routing for the same (query, schema).
 */

const COMPARISON_WORDS = new Set([
    'under', 'over', 'below', 'above',
    'less', 'more', 'than',
    'around', 'about', 'approximately', 'near', 'roughly', 'nearly',
    'between',
    'max', 'maximum', 'min', 'minimum',
]);

const STOP_WORDS = new Set([
    'a', 'an', 'the',
    'and', 'or', 'but',
    'of', 'in', 'on', 'at', 'for', 'with', 'by', 'to', 'from', 'as',
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'this', 'that', 'these', 'those',
]);

const OPERATOR_TOKEN_RE = /^([a-zA-Z_]\w*)(<=|>=|<|>|=|:)(.+)$/;
const DIGIT_RE = /\d/;

function fieldSection(fieldName, schema) {
    if (schema.text && schema.text.includes(fieldName)) return 'text';
    if (schema.metadata && schema.metadata.includes(fieldName)) return 'metadata';
    if (schema.tags && schema.tags.includes(fieldName)) return 'tags';
    return null;
}

function parseQuery(query, schema) {
    const tokens = query.trim().split(/\s+/).filter(t => t.length > 0);

    const hasTextSection = Array.isArray(schema.text) && schema.text.length > 0;
    const hasMetaSection = Array.isArray(schema.metadata) && schema.metadata.length > 0;
    const hasTagSection  = Array.isArray(schema.tags) && schema.tags.length > 0;

    const scores = { text: 0, metadata: 0, tags: 0 };
    function bump(section, value) {
        if (value > scores[section]) scores[section] = value;
    }

    let lastWasComparison = false;

    for (const token of tokens) {
        const lower = token.toLowerCase();

        const opMatch = token.match(OPERATOR_TOKEN_RE);
        if (opMatch) {
            const fieldName = opMatch[1];
            const section = fieldSection(fieldName, schema);
            if (!section) {
                return { error: `Unknown field: ${fieldName}` };
            }
            bump(section, 1.0);
            lastWasComparison = false;
            continue;
        }

        if (token.startsWith('#') && token.length > 1) {
            if (hasTagSection) bump('tags', 1.0);
            lastWasComparison = false;
            continue;
        }

        if (DIGIT_RE.test(token)) {
            if (hasMetaSection) bump('metadata', lastWasComparison ? 0.9 : 0.7);
            lastWasComparison = false;
            continue;
        }

        if (COMPARISON_WORDS.has(lower)) {
            if (hasMetaSection) bump('metadata', 0.5);
            lastWasComparison = true;
            continue;
        }

        if (STOP_WORDS.has(lower)) {
            continue;
        }

        const schemaSection = fieldSection(lower, schema);
        if (schemaSection) {
            bump(schemaSection, 0.9);
        } else {
            if (hasTextSection) bump('text', 0.7);
            if (hasTagSection) bump('tags', 0.4);
        }
        lastWasComparison = false;
    }

    const nodes = [];
    if (scores.text > 0)     nodes.push({ name: 'text',     confidence: scores.text });
    if (scores.metadata > 0) nodes.push({ name: 'metadata', confidence: scores.metadata });
    if (scores.tags > 0)     nodes.push({ name: 'tags',     confidence: scores.tags });

    nodes.sort((a, b) => b.confidence - a.confidence);

    if (nodes.length === 0 && hasTextSection) {
        nodes.push({ name: 'text', confidence: 0.3 });
    }

    return { nodes };
}

module.exports = { parseQuery };
