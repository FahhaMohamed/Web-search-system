const request = require('supertest');
const { app, setSchemaClient } = require('../app');

const fakeSchemas = {
    ecommerce: {
        text: ['title', 'description'],
        metadata: ['price', 'brand', 'size'],
        tags: ['color', 'category'],
    },
    logs: {
        text: ['message'],
        metadata: ['timestamp', 'level', 'service'],
    },
};

beforeAll(() => {
    setSchemaClient({
        fetch: async (domain) => fakeSchemas[domain] || null,
    });
});

async function nodes(domain, query) {
    const res = await request(app).post('/route').send({ domain, query });
    return res.body.nodes;
}

function nameOf(node) { return node.name; }

describe('confidence scores', () => {

    describe('response shape', () => {
        test('each node has name and confidence number', async () => {
            const list = await nodes('ecommerce', 'red shoes');
            for (const n of list) {
                expect(typeof n.name).toBe('string');
                expect(typeof n.confidence).toBe('number');
                expect(n.confidence).toBeGreaterThan(0);
                expect(n.confidence).toBeLessThanOrEqual(1);
            }
        });

        test('sorted by confidence descending', async () => {
            const list = await nodes('ecommerce', 'red shoes under 500');
            for (let i = 1; i < list.length; i++) {
                expect(list[i - 1].confidence).toBeGreaterThanOrEqual(list[i].confidence);
            }
        });
    });

    describe('explicit signals → confidence 1.0', () => {
        test('hashtag → tags with confidence 1.0', async () => {
            const list = await nodes('ecommerce', '#summer');
            expect(list).toHaveLength(1);
            expect(list[0].name).toBe('tags');
            expect(list[0].confidence).toBe(1.0);
        });

        test('operator with schema-resolved field → 1.0', async () => {
            const list = await nodes('ecommerce', 'price<500');
            expect(list).toHaveLength(1);
            expect(list[0].name).toBe('metadata');
            expect(list[0].confidence).toBe(1.0);
        });

        test('operator color:red on ecommerce → tags 1.0', async () => {
            const list = await nodes('ecommerce', 'color:red');
            expect(list[0].name).toBe('tags');
            expect(list[0].confidence).toBe(1.0);
        });
    });

    describe('ambiguous signals → lower confidence', () => {
        test('plain word "red shoes" → text > tags', async () => {
            const list = await nodes('ecommerce', 'red shoes');
            const text = list.find(n => n.name === 'text');
            const tags = list.find(n => n.name === 'tags');
            expect(text.confidence).toBeGreaterThan(tags.confidence);
            expect(text.confidence).toBe(0.7);
            expect(tags.confidence).toBe(0.4);
        });
    });

    describe('digit confidence depends on context', () => {
        test('digit after comparison word → metadata 0.9', async () => {
            const list = await nodes('ecommerce', 'shoes under 500');
            const meta = list.find(n => n.name === 'metadata');
            expect(meta.confidence).toBe(0.9);
        });

        test('digit alone (no comparison word) → metadata 0.7', async () => {
            const list = await nodes('ecommerce', 'shoes 500');
            const meta = list.find(n => n.name === 'metadata');
            expect(meta.confidence).toBe(0.7);
        });
    });

    describe('schema-matched plain word → 0.9', () => {
        test('"brand nike" on ecommerce → metadata 0.9', async () => {
            const list = await nodes('ecommerce', 'brand nike');
            const meta = list.find(n => n.name === 'metadata');
            expect(meta.confidence).toBe(0.9);
        });
    });

    describe('fallback', () => {
        test('whitespace query → text with confidence 0.3', async () => {
            const list = await nodes('ecommerce', ' ');
            expect(list).toEqual([{ name: 'text', confidence: 0.3 }]);
        });
    });
});
