const { generateDataset, toOldArchTextSplits } = require('../generate-dataset');

describe('generateDataset', () => {
    test('produces the requested number of documents', () => {
        const dataset = generateDataset({ size: 10, seed: 42 });
        expect(dataset.docs).toHaveLength(10);
    });

    test('same seed produces identical output (deterministic)', () => {
        const a = generateDataset({ size: 50, seed: 7 });
        const b = generateDataset({ size: 50, seed: 7 });
        expect(b).toEqual(a);
    });

    test('different seeds produce different output', () => {
        const a = generateDataset({ size: 50, seed: 1 });
        const b = generateDataset({ size: 50, seed: 2 });
        expect(b).not.toEqual(a);
    });

    test('each document has all required fields', () => {
        const dataset = generateDataset({ size: 5, seed: 1 });
        for (const d of dataset.docs) {
            expect(d).toHaveProperty('id');
            expect(d).toHaveProperty('title');
            expect(d).toHaveProperty('description');
            expect(d).toHaveProperty('price');
            expect(d).toHaveProperty('rating');
            expect(d).toHaveProperty('category');
            expect(d).toHaveProperty('brand');
        }
    });

    test('ids are unique across the dataset', () => {
        const dataset = generateDataset({ size: 1000, seed: 1 });
        const ids = new Set(dataset.docs.map(d => d.id));
        expect(ids.size).toBe(1000);
    });

    test('price is a positive number within sensible range', () => {
        const dataset = generateDataset({ size: 100, seed: 1 });
        for (const d of dataset.docs) {
            expect(typeof d.price).toBe('number');
            expect(d.price).toBeGreaterThan(0);
            expect(d.price).toBeLessThan(1000);
        }
    });

    test('rating is a number between 1 and 5', () => {
        const dataset = generateDataset({ size: 100, seed: 1 });
        for (const d of dataset.docs) {
            expect(typeof d.rating).toBe('number');
            expect(d.rating).toBeGreaterThanOrEqual(1);
            expect(d.rating).toBeLessThanOrEqual(5);
        }
    });

    test('category and brand are non-empty string arrays', () => {
        const dataset = generateDataset({ size: 20, seed: 1 });
        for (const d of dataset.docs) {
            expect(Array.isArray(d.category)).toBe(true);
            expect(Array.isArray(d.brand)).toBe(true);
            expect(d.category.length).toBeGreaterThan(0);
            expect(d.brand.length).toBeGreaterThan(0);
            expect(typeof d.category[0]).toBe('string');
            expect(typeof d.brand[0]).toBe('string');
        }
    });

    test('exposes the domain schema for the new architecture', () => {
        const dataset = generateDataset({ size: 1, seed: 1 });
        expect(dataset.schema).toEqual({
            text: ['title', 'description'],
            metadata: ['price', 'rating'],
            tags: ['category', 'brand'],
        });
    });

    test('text content uses a controlled vocabulary so queries are repeatable', () => {
        const dataset = generateDataset({ size: 500, seed: 9 });
        const titleWords = new Set();
        for (const d of dataset.docs) {
            for (const w of d.title.toLowerCase().split(/\s+/)) titleWords.add(w);
        }
        expect(titleWords.size).toBeLessThan(50);
    });
});

describe('toOldArchTextSplits', () => {
    test('produces 3 split files by default', () => {
        const dataset = generateDataset({ size: 30, seed: 1 });
        const splits = toOldArchTextSplits(dataset);
        expect(Object.keys(splits).sort()).toEqual(['split1.txt', 'split2.txt', 'split3.txt']);
    });

    test('produces N split files when count is given', () => {
        const dataset = generateDataset({ size: 30, seed: 1 });
        const splits = toOldArchTextSplits(dataset, 5);
        expect(Object.keys(splits)).toHaveLength(5);
    });

    test('every document title and description appears somewhere in the splits', () => {
        const dataset = generateDataset({ size: 20, seed: 1 });
        const splits = toOldArchTextSplits(dataset);
        const allText = Object.values(splits).join('\n').toLowerCase();
        for (const d of dataset.docs) {
            expect(allText).toContain(d.title.toLowerCase());
            expect(allText).toContain(d.description.toLowerCase());
        }
    });

    test('distributes documents roughly evenly across splits', () => {
        const dataset = generateDataset({ size: 300, seed: 1 });
        const splits = toOldArchTextSplits(dataset, 3);
        const sizes = Object.values(splits).map(s => s.split('\n').filter(Boolean).length);
        for (const size of sizes) {
            expect(size).toBeGreaterThanOrEqual(99);
            expect(size).toBeLessThanOrEqual(101);
        }
    });
});
