/**
 * Canonical-query translator.
 *
 * Canonical query shapes (engine-agnostic, one source of truth):
 *   { kind: 'text',  tokens: string, tokenType: 'single'|'multi' }
 *   { kind: 'range', field: string, op: '>'|'>='|'<'|'<='|'=', value: number }
 *   { kind: 'term',  field: string, value: string }
 *
 * Phase 1 exports `toElastic` only. `toMeili` and `toOurs` are added in
 * later phases to keep this file the single point of audit for fairness.
 */

const DOMAIN_SCHEMAS = {
    articles: {
        text: ['title', 'extract'],
        metadata: ['length', 'last_modified'],
        tags: ['categories'],
    },
    papers: {
        text: ['title', 'summary'],
        metadata: ['published_year'],
        tags: ['categories', 'authors'],
    },
    products: {
        text: ['product_name', 'ingredients_text'],
        metadata: ['nutriscore_numeric', 'energy_100g'],
        tags: ['categories', 'brands'],
    },
};

function getSchema(domain) {
    const s = DOMAIN_SCHEMAS[domain];
    if (!s) throw new Error(`unknown domain: ${domain}`);
    return s;
}

const OP_TO_ELASTIC = {
    '>': 'gt',
    '>=': 'gte',
    '<': 'lt',
    '<=': 'lte',
};

function toElastic(canonical, domain) {
    if (!canonical || typeof canonical !== 'object') {
        throw new Error('canonical query is required');
    }
    const schema = getSchema(domain);

    if (canonical.kind === 'text') {
        if (!canonical.tokens) throw new Error('text query: tokens is required');
        return {
            query: {
                multi_match: {
                    query: String(canonical.tokens),
                    fields: schema.text,
                },
            },
        };
    }

    if (canonical.kind === 'range') {
        if (!canonical.field) throw new Error('range query: field is required');
        if (canonical.value === undefined) throw new Error('range query: value is required');

        if (canonical.op === '=') {
            return {
                query: {
                    term: { [canonical.field]: canonical.value },
                },
            };
        }
        const esOp = OP_TO_ELASTIC[canonical.op];
        if (!esOp) {
            throw new Error(`unsupported range op: ${canonical.op}`);
        }
        return {
            query: {
                range: {
                    [canonical.field]: { [esOp]: canonical.value },
                },
            },
        };
    }

    if (canonical.kind === 'term') {
        if (!canonical.field) throw new Error('term query: field is required');
        if (canonical.value === undefined) throw new Error('term query: value is required');
        return {
            query: {
                term: { [canonical.field]: canonical.value },
            },
        };
    }

    throw new Error(`unknown query kind: ${canonical.kind}`);
}

function escapeMeiliValue(v) {
    if (typeof v === 'number') return String(v);
    // double-quoted string with backslash-escaping for quotes/backslashes
    const s = String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${s}"`;
}

function toMeili(canonical, domain) {
    if (!canonical || typeof canonical !== 'object') {
        throw new Error('canonical query is required');
    }
    getSchema(domain); // validates the domain exists

    if (canonical.kind === 'text') {
        if (!canonical.tokens) throw new Error('text query: tokens is required');
        return { q: String(canonical.tokens) };
    }

    if (canonical.kind === 'range') {
        if (!canonical.field) throw new Error('range query: field is required');
        if (canonical.value === undefined) throw new Error('range query: value is required');
        const op = canonical.op === '=' ? '=' : canonical.op;
        // Meili filter syntax: `field <op> <value>` with numeric or quoted-string value.
        const val = typeof canonical.value === 'number'
            ? String(canonical.value)
            : escapeMeiliValue(canonical.value);
        return { q: '', filter: `${canonical.field} ${op} ${val}` };
    }

    if (canonical.kind === 'term') {
        if (!canonical.field) throw new Error('term query: field is required');
        if (canonical.value === undefined) throw new Error('term query: value is required');
        return {
            q: '',
            filter: `${canonical.field} = ${escapeMeiliValue(canonical.value)}`,
        };
    }

    throw new Error(`unknown query kind: ${canonical.kind}`);
}

module.exports = {
    DOMAIN_SCHEMAS,
    getSchema,
    toElastic,
    toMeili,
};
