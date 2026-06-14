const { TextIndex } = require('../textIndex');

describe('TextIndex — inverted index for text search', () => {
    test('empty index returns no results', () => {
        const idx = new TextIndex();
        expect(idx.search('wireless', ['title'])).toEqual([]);
    });

    test('finds a doc whose title contains the query term', () => {
        const idx = new TextIndex();
        idx.add({ id: 'p1', title: 'wireless headphones' }, ['title']);
        const results = idx.search('wireless', ['title']);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('p1');
        expect(results[0].score).toBeGreaterThan(0);
    });

    test('title field weighted higher than description', () => {
        const idx = new TextIndex();
        idx.add({ id: 'p1', title: 'classic',     description: 'modern device' }, ['title', 'description']);
        idx.add({ id: 'p2', title: 'modern',      description: 'classic device' }, ['title', 'description']);
        const results = idx.search('classic', ['title', 'description']);
        // p1 has "classic" in title (weight 3), p2 has "classic" in description (weight 1)
        expect(results[0].id).toBe('p1');
        expect(results[1].id).toBe('p2');
        expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    test('returns multiple docs ranked by score, descending', () => {
        const idx = new TextIndex();
        idx.add({ id: 'p1', title: 'wireless' }, ['title']);
        idx.add({ id: 'p2', title: 'wireless headphones' }, ['title']);
        idx.add({ id: 'p3', title: 'plain' }, ['title']);
        const results = idx.search('wireless', ['title']);
        expect(results.map(r => r.id).sort()).toEqual(['p1', 'p2']);
        expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    });

    test('query with multiple terms accumulates scores', () => {
        const idx = new TextIndex();
        idx.add({ id: 'p1', title: 'fast wireless camera' }, ['title']);
        idx.add({ id: 'p2', title: 'fast' }, ['title']);
        const results = idx.search('fast wireless', ['title']);
        expect(results[0].id).toBe('p1');
        expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    test('ignores docs with no matching tokens', () => {
        const idx = new TextIndex();
        idx.add({ id: 'p1', title: 'nothing here' }, ['title']);
        expect(idx.search('wireless', ['title'])).toEqual([]);
    });

    test('stop words are ignored in queries', () => {
        const idx = new TextIndex();
        idx.add({ id: 'p1', title: 'wireless headphones' }, ['title']);
        expect(idx.search('the and of', ['title'])).toEqual([]);
    });

    test('case-insensitive match', () => {
        const idx = new TextIndex();
        idx.add({ id: 'p1', title: 'WIRELESS Headphones' }, ['title']);
        const results = idx.search('wireless', ['title']);
        expect(results).toHaveLength(1);
    });

    test('clear() empties the index', () => {
        const idx = new TextIndex();
        idx.add({ id: 'p1', title: 'wireless' }, ['title']);
        idx.clear();
        expect(idx.search('wireless', ['title'])).toEqual([]);
    });

    test('re-adding the same doc id replaces (does not double-count)', () => {
        const idx = new TextIndex();
        idx.add({ id: 'p1', title: 'wireless' }, ['title']);
        idx.add({ id: 'p1', title: 'wireless' }, ['title']);
        const results = idx.search('wireless', ['title']);
        expect(results).toHaveLength(1);
        const oneCopy = new TextIndex();
        oneCopy.add({ id: 'p1', title: 'wireless' }, ['title']);
        expect(results[0].score).toBe(oneCopy.search('wireless', ['title'])[0].score);
    });

    test('only fields passed to search() are considered', () => {
        const idx = new TextIndex();
        idx.add({ id: 'p1', title: 'wireless', description: 'modern' }, ['title', 'description']);
        const titleOnly = idx.search('modern', ['title']);
        expect(titleOnly).toEqual([]);
        const descOnly = idx.search('modern', ['description']);
        expect(descOnly).toHaveLength(1);
    });

    test('scales: 10000 docs, single-term query returns in O(matches), not O(docs)', () => {
        const idx = new TextIndex();
        for (let i = 0; i < 10000; i++) {
            const title = i % 100 === 0 ? `wireless device ${i}` : `plain device ${i}`;
            idx.add({ id: `p-${i}`, title }, ['title']);
        }
        const t0 = process.hrtime.bigint();
        const results = idx.search('wireless', ['title']);
        const elapsedMs = Number(process.hrtime.bigint() - t0) / 1_000_000;
        expect(results).toHaveLength(100);
        expect(elapsedMs).toBeLessThan(50); // generous — well under a linear scan would take
    });
});
