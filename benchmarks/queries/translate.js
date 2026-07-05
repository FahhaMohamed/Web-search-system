/**
 * Canonical-query translator.
 *
 * Canonical query shapes (engine-agnostic, one source of truth):
 *   { kind: 'text',  tokens: string, tokenType: 'single'|'multi' }
 *   { kind: 'range', field: string, op: '>'|'>='|'<'|'<='|'=', value: number }
 *   { kind: 'term',  field: string, value: string }
 *
 * Exports translators per engine — currently `toElastic` and `toOurs`.
 * This file is the single point of audit for fairness across engines.
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

/**
 * Normalize a tag-style value for our system. Our Specialty Node tokenizes
 * the query string on whitespace before parsing `field:value` pairs, so
 * multi-word tag values like "living people" can't survive raw. We replace
 * spaces with hyphens. This is paired with the same transform applied to
 * tag-field DATA at index time (see prepareDocs in the orchestrator), so
 * the canonical INTENT still matches the same docs across all engines.
 */
function oursTagSlug(v) {
    return String(v).trim().toLowerCase().replace(/\s+/g, '-');
}

function toOurs(canonical, domain) {
    if (!canonical || typeof canonical !== 'object') {
        throw new Error('canonical query is required');
    }
    getSchema(domain); // validates domain

    if (canonical.kind === 'text') {
        if (!canonical.tokens) throw new Error('text query: tokens is required');
        return { domain, query: String(canonical.tokens) };
    }

    if (canonical.kind === 'range') {
        if (!canonical.field) throw new Error('range query: field is required');
        if (canonical.value === undefined) throw new Error('range query: value is required');
        const op = canonical.op;
        return { domain, query: `${canonical.field}${op}${canonical.value}` };
    }

    if (canonical.kind === 'term') {
        if (!canonical.field) throw new Error('term query: field is required');
        if (canonical.value === undefined) throw new Error('term query: value is required');
        return {
            domain,
            query: `${canonical.field}:${oursTagSlug(canonical.value)}`,
        };
    }

    throw new Error(`unknown query kind: ${canonical.kind}`);
}

/**
 * OpenSearch is a fork of Elasticsearch 7.10.2 — same query DSL and
 * bulk API, so we can literally reuse the Elastic translator. Kept as
 * a named export so the harness reads cleanly.
 */
function toOpenSearch(canonical, domain) {
    return toElastic(canonical, domain);
}

/**
 * Solr uses Lucene query syntax over its /select endpoint. Escape any
 * Solr-special characters in tag values so multi-word or punctuated
 * values pass through unaltered. Range values map directly.
 */
const SOLR_ESCAPE_RE = /([+\-!(){}[\]^"~*?:\\/&|])/g;
function solrEscape(v) {
    return String(v).replace(SOLR_ESCAPE_RE, '\\$1');
}

function toSolr(canonical, domain) {
    if (!canonical || typeof canonical !== 'object') {
        throw new Error('canonical query is required');
    }
    const schema = getSchema(domain);

    if (canonical.kind === 'text') {
        if (!canonical.tokens) throw new Error('text query: tokens is required');
        // Search across all text fields — build an OR of field:token clauses.
        const tokens = String(canonical.tokens).trim().split(/\s+/);
        const parts = [];
        for (const field of schema.text) {
            for (const tok of tokens) parts.push(`${field}:${solrEscape(tok)}`);
        }
        return { q: parts.join(' OR '), rows: 20 };
    }

    if (canonical.kind === 'range') {
        if (!canonical.field) throw new Error('range query: field is required');
        if (canonical.value === undefined) throw new Error('range query: value is required');
        const v = canonical.value;
        let range;
        switch (canonical.op) {
            case '>':  range = `{${v} TO *]`; break;
            case '>=': range = `[${v} TO *]`; break;
            case '<':  range = `[* TO ${v}}`; break;
            case '<=': range = `[* TO ${v}]`; break;
            case '=':  return { q: `${canonical.field}:${v}`, rows: 20 };
            default: throw new Error(`unsupported range op: ${canonical.op}`);
        }
        return { q: `${canonical.field}:${range}`, rows: 20 };
    }

    if (canonical.kind === 'term') {
        if (!canonical.field) throw new Error('term query: field is required');
        if (canonical.value === undefined) throw new Error('term query: value is required');
        // Solr's default text-field behavior tokenizes on whitespace, so a
        // multi-word tag value stored as one phrase needs a phrase query.
        return { q: `${canonical.field}:"${solrEscape(canonical.value)}"`, rows: 20 };
    }

    throw new Error(`unknown query kind: ${canonical.kind}`);
}

module.exports = {
    DOMAIN_SCHEMAS,
    getSchema,
    toElastic,
    toOurs,
    toOpenSearch,
    toSolr,
    oursTagSlug,
    solrEscape,
};
