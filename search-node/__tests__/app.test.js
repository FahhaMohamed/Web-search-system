const request = require('supertest');
const { app, setSchemaClient, setDocStore, setSpecialty } = require('../app');
const { DocStore } = require('../docStore');

const SCHEMAS = {
    ecommerce: { text: ['title', 'description'], metadata: ['price', 'brand', 'size'], tags: ['color', 'category'] },
    logs:      { text: ['message'], metadata: ['level', 'service', 'timestamp'] },
};

function setUp(specialty) {
    setSpecialty(specialty);
    setDocStore(new DocStore());
    setSchemaClient({ fetch: async (d) => SCHEMAS[d] || null });
}

describe('search-node app — sanity', () => {
    test('GET /health returns 200 with specialty', async () => {
        setUp('text');
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'ok', specialty: 'text' });
    });
});

describe('search-node app — /index', () => {
    test('stores docs and returns indexed count', async () => {
        setUp('text');
        const res = await request(app)
            .post('/index')
            .send({
                domain: 'ecommerce',
                documents: [
                    { id: 'a', title: 'red shoes', description: 'in red' },
                    { id: 'b', title: 'blue boots', description: 'leather' },
                ],
            });
        expect(res.status).toBe(200);
        expect(res.body.indexed).toBe(2);
    });

    test('400 when documents array missing', async () => {
        setUp('text');
        const res = await request(app).post('/index').send({ domain: 'ecommerce' });
        expect(res.status).toBe(400);
    });

    test('400 when domain missing', async () => {
        setUp('text');
        const res = await request(app).post('/index').send({ documents: [] });
        expect(res.status).toBe(400);
    });
});

describe('search-node app — /search (text specialty)', () => {
    test('returns docs matching the query against schema.text fields', async () => {
        setUp('text');
        await request(app).post('/index').send({
            domain: 'ecommerce',
            documents: [
                { id: 'a', title: 'red shoes', description: 'sneakers' },
                { id: 'b', title: 'blue boots', description: 'leather' },
                { id: 'c', title: 'plain notebook', description: 'red cover' },
            ],
        });
        const res = await request(app).post('/search').send({ domain: 'ecommerce', query: 'red' });
        expect(res.status).toBe(200);
        const ids = res.body.results.map(r => r.id).sort();
        expect(ids).toEqual(['a', 'c']);
    });

    test('returns 404 when domain unknown', async () => {
        setUp('text');
        const res = await request(app).post('/search').send({ domain: 'nope', query: 'red' });
        expect(res.status).toBe(404);
    });

    test('400 when query missing', async () => {
        setUp('text');
        const res = await request(app).post('/search').send({ domain: 'ecommerce' });
        expect(res.status).toBe(400);
    });

    test('400 when domain missing', async () => {
        setUp('text');
        const res = await request(app).post('/search').send({ query: 'red' });
        expect(res.status).toBe(400);
    });
});

describe('search-node app — /search (metadata specialty)', () => {
    test('honors price<500 against schema.metadata fields', async () => {
        setUp('metadata');
        await request(app).post('/index').send({
            domain: 'ecommerce',
            documents: [
                { id: 'a', price: 100, brand: 'nike' },
                { id: 'b', price: 600, brand: 'puma' },
            ],
        });
        const res = await request(app).post('/search').send({ domain: 'ecommerce', query: 'price<500' });
        expect(res.body.results.map(r => r.id)).toEqual(['a']);
    });

    test('honors level:ERROR on logs domain', async () => {
        setUp('metadata');
        await request(app).post('/index').send({
            domain: 'logs',
            documents: [
                { id: 'l1', level: 'ERROR', service: 'api' },
                { id: 'l2', level: 'INFO', service: 'api' },
            ],
        });
        const res = await request(app).post('/search').send({ domain: 'logs', query: 'level:ERROR' });
        expect(res.body.results.map(r => r.id)).toEqual(['l1']);
    });

    test('returns empty results if domain has no metadata section', async () => {
        setUp('metadata');
        setSchemaClient({ fetch: async () => ({ text: ['body'] }) });
        const res = await request(app).post('/search').send({ domain: 'whatever', query: 'price<500' });
        expect(res.body.results).toEqual([]);
    });
});

describe('search-node app — /search (tags specialty)', () => {
    test('honors color:red against schema.tags', async () => {
        setUp('tags');
        await request(app).post('/index').send({
            domain: 'ecommerce',
            documents: [
                { id: 'a', color: ['red'],  category: ['shoes'] },
                { id: 'b', color: ['blue'], category: ['shoes'] },
            ],
        });
        const res = await request(app).post('/search').send({ domain: 'ecommerce', query: 'color:red' });
        expect(res.body.results.map(r => r.id)).toEqual(['a']);
    });

    test('returns empty if domain has no tags section', async () => {
        setUp('tags');
        const res = await request(app).post('/search').send({ domain: 'logs', query: '#anything' });
        expect(res.body.results).toEqual([]);
    });
});

describe('search-node app — response shape', () => {
    test('response includes domain, query, results, and node specialty', async () => {
        setUp('text');
        await request(app).post('/index').send({
            domain: 'ecommerce',
            documents: [{ id: 'a', title: 'red' }],
        });
        const res = await request(app).post('/search').send({ domain: 'ecommerce', query: 'red' });
        expect(res.body).toMatchObject({
            domain: 'ecommerce',
            query: 'red',
            specialty: 'text',
        });
        expect(Array.isArray(res.body.results)).toBe(true);
    });
});
