const { textSearch } = require('../textSearch');

const docs = [
    { id: 'a', title: 'red shoes',        description: 'Comfortable sneakers in red' },
    { id: 'b', title: 'blue boots',       description: 'Leather boots, warm and stylish' },
    { id: 'c', title: 'running shoes',    description: 'Lightweight red running shoes for sport' },
    { id: 'd', title: 'plain notebook',   description: 'a4 notebook, 100 pages' },
];

const FIELDS = ['title', 'description'];

describe('textSearch', () => {
    test('returns docs whose configured text fields contain the term', () => {
        const results = textSearch('red', docs, FIELDS);
        const ids = results.map(r => r.id).sort();
        expect(ids).toEqual(['a', 'c']);
    });

    test('case-insensitive match', () => {
        const results = textSearch('RED', docs, FIELDS);
        expect(results.map(r => r.id).sort()).toEqual(['a', 'c']);
    });

    test('multi-word query: docs matching more words score higher', () => {
        const results = textSearch('red shoes', docs, FIELDS);
        expect(results[0].id).toBe('a');
        expect(results.find(r => r.id === 'c')).toBeDefined();
        expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    test('title match outweighs description-only match', () => {
        const results = textSearch('red', docs, FIELDS);
        const a = results.find(r => r.id === 'a');
        const c = results.find(r => r.id === 'c');
        expect(a.score).toBeGreaterThan(c.score);
    });

    test('no match returns empty array', () => {
        expect(textSearch('zebra', docs, FIELDS)).toEqual([]);
    });

    test('result preserves original doc fields', () => {
        const results = textSearch('red', docs, FIELDS);
        const a = results.find(r => r.id === 'a');
        expect(a).toMatchObject({ id: 'a', title: 'red shoes', description: 'Comfortable sneakers in red' });
        expect(typeof a.score).toBe('number');
    });

    test('only searches the configured fields', () => {
        const docs = [{ id: 'x', title: 'apple', body: 'red apple', color: 'red' }];
        const results = textSearch('red', docs, ['title']);
        expect(results).toEqual([]);
    });

    test('whitespace-only query returns empty', () => {
        expect(textSearch('  ', docs, FIELDS)).toEqual([]);
    });

    test('ignores stop words in scoring', () => {
        const docs = [
            { id: 'p', title: 'the red shoes' },
            { id: 'q', title: 'red shoes' },
        ];
        const results = textSearch('the red', docs, ['title']);
        const p = results.find(r => r.id === 'p');
        const q = results.find(r => r.id === 'q');
        expect(p.score).toBe(q.score);
    });

    test('results are sorted by score descending', () => {
        const results = textSearch('red running shoes', docs, FIELDS);
        for (let i = 1; i < results.length; i++) {
            expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
        }
    });
});
