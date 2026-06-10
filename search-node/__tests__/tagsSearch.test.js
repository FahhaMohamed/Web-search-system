const { tagsSearch } = require('../tagsSearch');

const ecommerce = [
    { id: 'a', color: ['red'],        category: ['shoes'] },
    { id: 'b', color: ['blue'],       category: ['shoes'] },
    { id: 'c', color: ['red', 'pink'],category: ['hats']  },
    { id: 'd', color: ['green'],      category: ['summer'] },
];
const ECOM_TAG_FIELDS = ['color', 'category'];

const social = [
    { id: 's1', hashtags: ['summer', 'beach'] },
    { id: 's2', hashtags: ['winter', 'snow']  },
    { id: 's3', hashtags: ['summer', 'fun']   },
];
const SOCIAL_TAG_FIELDS = ['hashtags'];

describe('tagsSearch — explicit field:value', () => {
    test('color:red matches docs with red in color', () => {
        const r = tagsSearch('color:red', ecommerce, ECOM_TAG_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['a', 'c']);
    });

    test('category:shoes matches docs in shoes', () => {
        const r = tagsSearch('category:shoes', ecommerce, ECOM_TAG_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['a', 'b']);
    });

    test('field:value is case-insensitive', () => {
        const r = tagsSearch('color:RED', ecommerce, ECOM_TAG_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['a', 'c']);
    });

    test('unknown field → empty', () => {
        expect(tagsSearch('xyz:red', ecommerce, ECOM_TAG_FIELDS)).toEqual([]);
    });
});

describe('tagsSearch — hashtag', () => {
    test('#summer matches any tag field containing summer', () => {
        const r = tagsSearch('#summer', social, SOCIAL_TAG_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['s1', 's3']);
    });

    test('#red on ecommerce hits color tag', () => {
        const r = tagsSearch('#red', ecommerce, ECOM_TAG_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['a', 'c']);
    });

    test('multiple hashtags AND together', () => {
        const r = tagsSearch('#summer #beach', social, SOCIAL_TAG_FIELDS);
        expect(r.map(d => d.id)).toEqual(['s1']);
    });
});

describe('tagsSearch — plain words', () => {
    test('plain word matches any tag value', () => {
        const r = tagsSearch('red', ecommerce, ECOM_TAG_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['a', 'c']);
    });

    test('two plain words: doc must match both (AND)', () => {
        const r = tagsSearch('red shoes', ecommerce, ECOM_TAG_FIELDS);
        expect(r.map(d => d.id)).toEqual(['a']);
    });

    test('case-insensitive plain match', () => {
        const r = tagsSearch('RED', ecommerce, ECOM_TAG_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['a', 'c']);
    });

    test('stop words are ignored', () => {
        const r = tagsSearch('the red shoes', ecommerce, ECOM_TAG_FIELDS);
        expect(r.map(d => d.id)).toEqual(['a']);
    });
});

describe('tagsSearch — mixed', () => {
    test('color:red + plain category match (shoes)', () => {
        const r = tagsSearch('color:red shoes', ecommerce, ECOM_TAG_FIELDS);
        expect(r.map(d => d.id)).toEqual(['a']);
    });
});

describe('tagsSearch — edge cases', () => {
    test('no matching tag values → empty', () => {
        expect(tagsSearch('zebra', ecommerce, ECOM_TAG_FIELDS)).toEqual([]);
    });

    test('whitespace-only → empty', () => {
        expect(tagsSearch('   ', ecommerce, ECOM_TAG_FIELDS)).toEqual([]);
    });

    test('result includes score and preserves doc fields', () => {
        const r = tagsSearch('color:red', ecommerce, ECOM_TAG_FIELDS);
        expect(r[0]).toMatchObject({ id: 'a', color: ['red'] });
        expect(typeof r[0].score).toBe('number');
        expect(r[0].score).toBeGreaterThan(0);
    });

    test('explicit field:value scores higher than plain word match', () => {
        const r1 = tagsSearch('red', ecommerce, ECOM_TAG_FIELDS);
        const r2 = tagsSearch('color:red', ecommerce, ECOM_TAG_FIELDS);
        const a1 = r1.find(d => d.id === 'a');
        const a2 = r2.find(d => d.id === 'a');
        expect(a2.score).toBeGreaterThan(a1.score);
    });
});
