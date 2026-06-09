const request = require('supertest');
const { app } = require('../app');
const { usePermissiveSchema } = require('../test-helpers/permissive-schema');

beforeAll(() => {
    usePermissiveSchema();
});

async function route(domain, query) {
    const response = await request(app).post('/route').send({ domain, query });
    return response.body.nodes.map(n => n.name);
}

describe('POST /route — Layer 1: domain-agnostic routing', () => {

    describe('plain words → text + tags (any domain)', () => {
        test('ecommerce: "red shoes"', async () => {
            const nodes = await route('ecommerce', 'red shoes');
            expect(nodes).toEqual(expect.arrayContaining(['text', 'tags']));
            expect(nodes).not.toContain('metadata');
            expect(nodes.length).toBe(2);
        });
        test('logs: "error connection"', async () => {
            const nodes = await route('logs', 'error connection');
            expect(nodes).toEqual(expect.arrayContaining(['text', 'tags']));
            expect(nodes).not.toContain('metadata');
        });
        test('social: "javascript tutorial"', async () => {
            const nodes = await route('social', 'javascript tutorial');
            expect(nodes).toEqual(expect.arrayContaining(['text', 'tags']));
            expect(nodes).not.toContain('metadata');
        });
        test('recipes: "pasta carbonara"', async () => {
            const nodes = await route('recipes', 'pasta carbonara');
            expect(nodes).toEqual(expect.arrayContaining(['text', 'tags']));
            expect(nodes).not.toContain('metadata');
        });
    });

    describe('digit triggers metadata across all domains', () => {
        test('ecommerce: "red shoes 500"', async () => {
            const nodes = await route('ecommerce', 'red shoes 500');
            expect(nodes).toEqual(expect.arrayContaining(['text', 'tags', 'metadata']));
            expect(nodes.length).toBe(3);
        });
        test('logs: "errors 100"', async () => {
            const nodes = await route('logs', 'errors 100');
            expect(nodes).toEqual(expect.arrayContaining(['text', 'tags', 'metadata']));
        });
        test('realestate: "house 3 bedrooms"', async () => {
            const nodes = await route('realestate', 'house 3 bedrooms');
            expect(nodes).toEqual(expect.arrayContaining(['text', 'tags', 'metadata']));
        });
        test('papers: "publications 2020"', async () => {
            const nodes = await route('papers', 'publications 2020');
            expect(nodes).toEqual(expect.arrayContaining(['text', 'tags', 'metadata']));
        });
    });

    describe('comparison words trigger metadata', () => {
        const cases = [
            ['ecommerce', 'red shoes under 500'],
            ['ecommerce', 'shoes below 500'],
            ['logs', 'errors over 100'],
            ['logs', 'requests above 200'],
            ['social', 'tutorial more than 100 likes'],
            ['ecommerce', 'shoes less than 500'],
            ['ecommerce', 'shoes around 500'],
            ['papers', 'papers about 50 citations'],
            ['ecommerce', 'shoes approximately 500'],
            ['ecommerce', 'shoes near 500'],
        ];
        test.each(cases)('%s: "%s" includes metadata', async (domain, query) => {
            const nodes = await route(domain, query);
            expect(nodes).toContain('metadata');
        });
    });

    describe('range patterns trigger metadata', () => {
        test('between X and Y: "shoes between 100 and 500"', async () => {
            const nodes = await route('ecommerce', 'shoes between 100 and 500');
            expect(nodes).toContain('metadata');
        });
        test('X to Y: "shoes from 100 to 500"', async () => {
            const nodes = await route('ecommerce', 'shoes from 100 to 500');
            expect(nodes).toContain('metadata');
        });
        test('hyphen range: "shoes 100-500"', async () => {
            const nodes = await route('ecommerce', 'shoes 100-500');
            expect(nodes).toContain('metadata');
        });
    });

    describe('operators trigger metadata only (no plain words)', () => {
        test('< : "price<500"', async () => {
            expect(await route('ecommerce', 'price<500')).toEqual(['metadata']);
        });
        test('= : "brand=nike"', async () => {
            expect(await route('ecommerce', 'brand=nike')).toEqual(['metadata']);
        });
        test(': : "level:ERROR"', async () => {
            expect(await route('logs', 'level:ERROR')).toEqual(['metadata']);
        });
        test('> : "rating>4"', async () => {
            expect(await route('ecommerce', 'rating>4')).toEqual(['metadata']);
        });
    });

    describe('hashtag narrows to tags', () => {
        test('"#summer" alone', async () => {
            expect(await route('ecommerce', '#summer')).toEqual(['tags']);
        });
        test('multiple hashtags', async () => {
            expect(await route('social', '#js #tutorial')).toEqual(['tags']);
        });
        test('plain + hashtag → text + tags', async () => {
            const nodes = await route('ecommerce', 'red shoes #summer');
            expect(nodes).toEqual(expect.arrayContaining(['text', 'tags']));
            expect(nodes).not.toContain('metadata');
        });
    });

    describe('combinations', () => {
        test('plain + operator → all 3', async () => {
            const nodes = await route('ecommerce', 'red shoes price<500');
            expect(nodes).toEqual(expect.arrayContaining(['text', 'tags', 'metadata']));
        });
        test('plain + comparison + digit + hashtag → all 3', async () => {
            const nodes = await route('ecommerce', 'red shoes under 500 #summer');
            expect(nodes).toEqual(expect.arrayContaining(['text', 'tags', 'metadata']));
            expect(nodes.length).toBe(3);
        });
        test('hashtag + metadata only (no plain) → tags + metadata', async () => {
            const nodes = await route('ecommerce', '#summer under 500');
            expect(nodes).toEqual(expect.arrayContaining(['tags', 'metadata']));
            expect(nodes).not.toContain('text');
        });
    });

    describe('stop words are ignored for text/tags decision', () => {
        test('"the red shoes" → text + tags ("the" ignored)', async () => {
            const nodes = await route('ecommerce', 'the red shoes');
            expect(nodes).toEqual(expect.arrayContaining(['text', 'tags']));
            expect(nodes).not.toContain('metadata');
        });
        test('"between 100 and 500" → metadata only ("and" ignored)', async () => {
            expect(await route('ecommerce', 'between 100 and 500')).toEqual(['metadata']);
        });
        test('"red and white shoes" → text + tags', async () => {
            const nodes = await route('ecommerce', 'red and white shoes');
            expect(nodes).toEqual(expect.arrayContaining(['text', 'tags']));
            expect(nodes).not.toContain('metadata');
        });
    });

    describe('fallback', () => {
        test('whitespace-only query → text', async () => {
            expect(await route('ecommerce', ' ')).toEqual(['text']);
        });
    });
});
