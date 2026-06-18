const queriesFile = require('../queries/text-queries.json');

describe('text-queries.json (external Open Library dataset)', () => {
    test('contains exactly 40 queries (20 single + 20 multi)', () => {
        expect(queriesFile.queries).toHaveLength(40);
        const single = queriesFile.queries.filter((q) => q.type === 'single');
        const multi = queriesFile.queries.filter((q) => q.type === 'multi');
        expect(single).toHaveLength(20);
        expect(multi).toHaveLength(20);
    });

    test('every query has shape { text, type }', () => {
        for (const q of queriesFile.queries) {
            expect(typeof q.text).toBe('string');
            expect(['single', 'multi']).toContain(q.type);
        }
    });

    test('single-token queries are exactly one lowercase word', () => {
        for (const q of queriesFile.queries.filter((q) => q.type === 'single')) {
            expect(q.text).toMatch(/^[a-z]+$/);
        }
    });

    test('multi-token queries are 2+ lowercase words', () => {
        for (const q of queriesFile.queries.filter((q) => q.type === 'multi')) {
            const tokens = q.text.split(/\s+/);
            expect(tokens.length).toBeGreaterThanOrEqual(2);
            for (const tok of tokens) {
                expect(tok).toMatch(/^[a-z]+$/);
            }
        }
    });

    test('all query texts are unique', () => {
        const texts = queriesFile.queries.map((q) => q.text);
        expect(new Set(texts).size).toBe(texts.length);
    });

    test('domain matches the external dataset', () => {
        expect(queriesFile.domain).toBe('books');
    });
});
