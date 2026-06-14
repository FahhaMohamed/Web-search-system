const queriesFile = require('../queries/text-queries.json');
const { generateDataset } = require('../generate-dataset');

const SEED = 42;
const SIZES = [100, 1000, 10000, 100000];

function docContainsWord(doc, word) {
    const w = word.toLowerCase();
    return (
        doc.title.toLowerCase().split(/\s+/).includes(w) ||
        doc.description.toLowerCase().split(/\s+/).includes(w)
    );
}

describe('text-queries.json', () => {
    test('contains exactly 20 queries', () => {
        expect(queriesFile.queries).toHaveLength(20);
    });

    test('every query is a single lowercase word', () => {
        for (const q of queriesFile.queries) {
            expect(q).toMatch(/^[a-z]+$/);
        }
    });

    test('queries are unique', () => {
        const set = new Set(queriesFile.queries);
        expect(set.size).toBe(queriesFile.queries.length);
    });

    test.each(SIZES)('every query word appears in at least one doc at size=%i', (size) => {
        const { docs } = generateDataset({ size, seed: SEED });
        for (const q of queriesFile.queries) {
            const hit = docs.find(d => docContainsWord(d, q));
            expect(hit).toBeDefined();
        }
    });

    test('query selectivity is varied (not all queries hit every doc)', () => {
        const { docs } = generateDataset({ size: 1000, seed: SEED });
        const hitRates = queriesFile.queries.map(q => {
            const hits = docs.filter(d => docContainsWord(d, q)).length;
            return hits / docs.length;
        });
        const min = Math.min(...hitRates);
        const max = Math.max(...hitRates);
        expect(min).toBeGreaterThan(0);
        expect(max).toBeLessThan(1);
    });
});
