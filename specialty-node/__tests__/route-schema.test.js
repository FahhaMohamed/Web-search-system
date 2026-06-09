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
    textonly: {
        text: ['body'],
    },
};

beforeAll(() => {
    setSchemaClient({
        fetch: async (domain) => fakeSchemas[domain] || null,
    });
});

async function route(domain, query) {
    return await request(app).post('/route').send({ domain, query });
}

function names(res) {
    return res.body.nodes.map(n => n.name);
}

describe('Layer 2 — schema-aware routing', () => {

    describe('unknown domain', () => {
        test('returns 404 when domain is not registered', async () => {
            const res = await route('nonexistent', 'red shoes');
            expect(res.status).toBe(404);
            expect(res.body.error).toMatch(/not found/i);
        });
    });

    describe('schema missing a section', () => {
        test('domain without tags: plain words route to text only', async () => {
            const res = await route('logs', 'error connection');
            expect(res.status).toBe(200);
            expect(names(res)).toEqual(['text']);
        });

        test('domain without tags: #hashtag is ignored, falls back to text', async () => {
            const res = await route('logs', '#error');
            expect(names(res)).toEqual(['text']);
        });

        test('domain without metadata: digits do not trigger metadata', async () => {
            const res = await route('textonly', 'document 500');
            expect(names(res)).not.toContain('metadata');
        });
    });

    describe('operator field is looked up in schema', () => {
        test('color:red on ecommerce → tags (color is a tag field)', async () => {
            const res = await route('ecommerce', 'color:red');
            expect(names(res)).toEqual(['tags']);
        });

        test('price<500 on ecommerce → metadata (price is a metadata field)', async () => {
            const res = await route('ecommerce', 'price<500');
            expect(names(res)).toEqual(['metadata']);
        });

        test('title:hello on ecommerce → text (title is a text field)', async () => {
            const res = await route('ecommerce', 'title:hello');
            expect(names(res)).toEqual(['text']);
        });

        test('level:ERROR on logs → metadata (level is a metadata field)', async () => {
            const res = await route('logs', 'level:ERROR');
            expect(names(res)).toEqual(['metadata']);
        });

        test('unknown field with operator returns 400', async () => {
            const res = await route('ecommerce', 'xyz:foo');
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/unknown field/i);
        });
    });

    describe('plain field name in query triggers correct section', () => {
        test('"brand nike" on ecommerce → metadata + text + tags (brand is metadata field)', async () => {
            const res = await route('ecommerce', 'brand nike');
            expect(names(res)).toContain('metadata');
        });

        test('"shoes color" on ecommerce → tags via color schema match', async () => {
            const res = await route('ecommerce', 'shoes color');
            expect(names(res)).toContain('tags');
        });
    });
});
