const { metadataSearch } = require('../metadataSearch');

const ecommerce = [
    { id: 'a', price: 100, brand: 'nike',  size: 9  },
    { id: 'b', price: 250, brand: 'adidas', size: 10 },
    { id: 'c', price: 500, brand: 'nike',  size: 11 },
    { id: 'd', price: 800, brand: 'puma',  size: 9  },
];
const ECOM_FIELDS = ['price', 'brand', 'size'];

const logs = [
    { id: 'l1', level: 'ERROR', service: 'api',  timestamp: 1000 },
    { id: 'l2', level: 'INFO',  service: 'api',  timestamp: 1100 },
    { id: 'l3', level: 'ERROR', service: 'db',   timestamp: 1200 },
];
const LOG_FIELDS = ['level', 'service', 'timestamp'];

describe('metadataSearch — operator tokens', () => {
    test('price<500 keeps docs strictly less than 500', () => {
        const r = metadataSearch('price<500', ecommerce, ECOM_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['a', 'b']);
    });

    test('price<=500 includes exactly 500', () => {
        const r = metadataSearch('price<=500', ecommerce, ECOM_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['a', 'b', 'c']);
    });

    test('price>100 strictly greater', () => {
        const r = metadataSearch('price>100', ecommerce, ECOM_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['b', 'c', 'd']);
    });

    test('price>=500', () => {
        const r = metadataSearch('price>=500', ecommerce, ECOM_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['c', 'd']);
    });

    test('price=250 exact match on numeric', () => {
        const r = metadataSearch('price=250', ecommerce, ECOM_FIELDS);
        expect(r.map(d => d.id)).toEqual(['b']);
    });

    test('brand=nike string equality (case-insensitive)', () => {
        const r = metadataSearch('brand=NIKE', ecommerce, ECOM_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['a', 'c']);
    });

    test('level:ERROR colon-as-equality on logs', () => {
        const r = metadataSearch('level:ERROR', logs, LOG_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['l1', 'l3']);
    });
});

describe('metadataSearch — AND-combine constraints', () => {
    test('two operator constraints both must hold', () => {
        const r = metadataSearch('price<500 brand=nike', ecommerce, ECOM_FIELDS);
        expect(r.map(d => d.id)).toEqual(['a']);
    });

    test('three constraints', () => {
        const r = metadataSearch('price<800 brand=nike size=9', ecommerce, ECOM_FIELDS);
        expect(r.map(d => d.id)).toEqual(['a']);
    });
});

describe('metadataSearch — comparison-word + digit', () => {
    test('"price under 500" same as price<500', () => {
        const r = metadataSearch('price under 500', ecommerce, ECOM_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['a', 'b']);
    });

    test('"price over 200" same as price>200', () => {
        const r = metadataSearch('price over 200', ecommerce, ECOM_FIELDS);
        expect(r.map(d => d.id).sort()).toEqual(['b', 'c', 'd']);
    });

    test('"price above 500" same as price>500', () => {
        const r = metadataSearch('price above 500', ecommerce, ECOM_FIELDS);
        expect(r.map(d => d.id)).toEqual(['d']);
    });

    test('"price below 250" same as price<250', () => {
        const r = metadataSearch('price below 250', ecommerce, ECOM_FIELDS);
        expect(r.map(d => d.id)).toEqual(['a']);
    });
});

describe('metadataSearch — edge cases', () => {
    test('no operator constraints at all → empty', () => {
        expect(metadataSearch('red shoes', ecommerce, ECOM_FIELDS)).toEqual([]);
    });

    test('unknown field → empty (defensive)', () => {
        expect(metadataSearch('xyz<500', ecommerce, ECOM_FIELDS)).toEqual([]);
    });

    test('whitespace query → empty', () => {
        expect(metadataSearch('   ', ecommerce, ECOM_FIELDS)).toEqual([]);
    });

    test('result preserves doc fields and adds score', () => {
        const r = metadataSearch('price<500 brand=nike', ecommerce, ECOM_FIELDS);
        expect(r[0]).toMatchObject({ id: 'a', price: 100, brand: 'nike' });
        expect(typeof r[0].score).toBe('number');
        expect(r[0].score).toBeGreaterThan(0);
    });

    test('more constraints matched → higher score', () => {
        const r1 = metadataSearch('price<500', ecommerce, ECOM_FIELDS);
        const r2 = metadataSearch('price<500 brand=nike', ecommerce, ECOM_FIELDS);
        const a1 = r1.find(d => d.id === 'a');
        const a2 = r2.find(d => d.id === 'a');
        expect(a2.score).toBeGreaterThan(a1.score);
    });
});
