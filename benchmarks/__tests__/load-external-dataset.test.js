const {
    sliceRanges,
    sliceForSize,
    mapOlRecord,
    dedupeById,
    SUPPORTED_SIZES,
} = require('../load-external-dataset');

describe('sliceRanges', () => {
    test('returns non-overlapping ranges for the four supported sizes', () => {
        const r = sliceRanges();
        expect(r[100]).toEqual([0, 100]);
        expect(r[1000]).toEqual([100, 1100]);
        expect(r[10000]).toEqual([1100, 11100]);
        expect(r[100000]).toEqual([11100, 111100]);
    });

    test('every supported size has a range with the right length', () => {
        const r = sliceRanges();
        for (const s of SUPPORTED_SIZES) {
            expect(r[s]).toBeDefined();
            expect(r[s][1] - r[s][0]).toBe(s);
        }
    });
});

describe('sliceForSize', () => {
    test('returns exactly `size` records starting at the right offset', () => {
        const cache = Array.from({ length: 111100 }, (_, i) => ({ id: `ol-${i}` }));
        const slice = sliceForSize(cache, 1000);
        expect(slice).toHaveLength(1000);
        expect(slice[0].id).toBe('ol-100');
        expect(slice[999].id).toBe('ol-1099');
    });

    test('four slices for the four sizes share zero IDs (non-overlap guarantee)', () => {
        const cache = Array.from({ length: 111100 }, (_, i) => ({ id: `ol-${i}` }));
        const allIds = new Set();
        let total = 0;
        for (const size of SUPPORTED_SIZES) {
            const slice = sliceForSize(cache, size);
            for (const doc of slice) {
                expect(allIds.has(doc.id)).toBe(false);
                allIds.add(doc.id);
            }
            total += slice.length;
        }
        expect(allIds.size).toBe(total);
        expect(total).toBe(100 + 1000 + 10000 + 100000);
    });

    test('throws when the cache is too small for the requested size', () => {
        const cache = Array.from({ length: 200 }, (_, i) => ({ id: `ol-${i}` }));
        expect(() => sliceForSize(cache, 1000)).toThrow(/not enough records/i);
    });

    test('throws on unsupported sizes', () => {
        const cache = Array.from({ length: 111100 }, (_, i) => ({ id: `ol-${i}` }));
        expect(() => sliceForSize(cache, 500)).toThrow(/unsupported size/i);
    });
});

describe('mapOlRecord', () => {
    test('maps a typical Open Library record to our schema', () => {
        const ol = {
            key: '/works/OL27448W',
            title: 'Fellowship of the Ring',
            author_name: ['J.R.R. Tolkien'],
            subject: ['Fantasy fiction', 'Hobbits (Imaginary creatures)', 'Adventure stories'],
            first_sentence: 'When Mr. Bilbo Baggins of Bag End announced...',
            first_publish_year: 1954,
        };
        const doc = mapOlRecord(ol);
        expect(doc).toMatchObject({
            id: 'ol-OL27448W',
            title: 'fellowship of the ring',
            description: expect.stringContaining('hobbits'),
            brand: expect.arrayContaining(['j.r.r. tolkien']),
            category: expect.arrayContaining(['fantasy fiction']),
        });
        expect(typeof doc.price).toBe('number');
        expect(doc.price).toBeGreaterThan(0);
        expect(typeof doc.rating).toBe('number');
        expect(doc.rating).toBeGreaterThanOrEqual(1);
        expect(doc.rating).toBeLessThanOrEqual(5);
    });

    test('returns null when title is missing or empty', () => {
        expect(mapOlRecord({ key: '/works/OL1W', title: '', subject: ['x'] })).toBeNull();
        expect(mapOlRecord({ key: '/works/OL1W', subject: ['x'] })).toBeNull();
    });

    test('returns null when no description content (subject + first_sentence both empty)', () => {
        expect(mapOlRecord({ key: '/works/OL1W', title: 'A Book' })).toBeNull();
    });

    test('uses subject text when first_sentence is missing', () => {
        const doc = mapOlRecord({
            key: '/works/OL2W',
            title: 'Book',
            subject: ['historical fiction', 'medieval'],
        });
        expect(doc.description).toContain('historical');
    });

    test('uses first_sentence when subject is empty', () => {
        const doc = mapOlRecord({
            key: '/works/OL3W',
            title: 'Book',
            first_sentence: 'It was a dark and stormy night',
        });
        expect(doc.description).toContain('dark');
    });

    test('handles array-shaped first_sentence (OL sometimes returns array)', () => {
        const doc = mapOlRecord({
            key: '/works/OL4W',
            title: 'Book',
            first_sentence: ['The first sentence', 'fallback'],
            subject: ['fiction'],
        });
        expect(doc.description).toContain('first sentence');
    });

    test('price is deterministic for the same key', () => {
        const r = { key: '/works/OL99W', title: 'X', subject: ['fiction'] };
        expect(mapOlRecord(r).price).toBe(mapOlRecord(r).price);
    });

    test('rating is between 1 and 5', () => {
        for (let i = 0; i < 50; i++) {
            const r = { key: `/works/OL${i}W`, title: 'X', subject: ['fiction'] };
            const doc = mapOlRecord(r);
            expect(doc.rating).toBeGreaterThanOrEqual(1);
            expect(doc.rating).toBeLessThanOrEqual(5);
        }
    });

    test('extracts short key from full path', () => {
        const doc = mapOlRecord({
            key: '/works/OL12345W',
            title: 'X',
            subject: ['fiction'],
        });
        expect(doc.id).toBe('ol-OL12345W');
    });

    test('handles records with no author or subject gracefully', () => {
        const doc = mapOlRecord({
            key: '/works/OL1W',
            title: 'Book',
            first_sentence: 'hello world',
        });
        expect(Array.isArray(doc.brand)).toBe(true);
        expect(Array.isArray(doc.category)).toBe(true);
    });
});

describe('dedupeById', () => {
    test('removes duplicate ids, keeping first occurrence', () => {
        const docs = [
            { id: 'a', title: 'first' },
            { id: 'b', title: 'second' },
            { id: 'a', title: 'duplicate' },
            { id: 'c', title: 'third' },
        ];
        const out = dedupeById(docs);
        expect(out).toHaveLength(3);
        expect(out.map((d) => d.id)).toEqual(['a', 'b', 'c']);
        expect(out[0].title).toBe('first');
    });
});
