const request = require('supertest');
const { createApp } = require('../app');

const SCHEMAS = {
    ecommerce: { text: ['title'], metadata: ['price'], tags: ['color'] },
    logs:      { text: ['message'], metadata: ['level'] },
};

function makeApp(stubs = {}) {
    const schemaClient = stubs.schemaClient || { fetch: async (d) => SCHEMAS[d] || null };
    const indexClient = stubs.indexClient || {
        fanOut: async (domain, docs) => [
            { node: 'text', ok: true, indexed: docs.length },
            { node: 'metadata', ok: true, indexed: docs.length },
            { node: 'tags', ok: true, indexed: docs.length },
        ],
    };
    return createApp({ nodeId: 'index-test', schemaClient, indexClient });
}

describe('index-node app — /health', () => {
    test('200 with nodeId and service', async () => {
        const res = await request(makeApp()).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'ok', service: 'index-node', nodeId: 'index-test' });
    });
});

describe('index-node app — /index validation', () => {
    test('400 when domain missing', async () => {
        const res = await request(makeApp()).post('/index').send({ documents: [{ id: 'a' }] });
        expect(res.status).toBe(400);
    });

    test('400 when documents missing or not array', async () => {
        const res1 = await request(makeApp()).post('/index').send({ domain: 'ecommerce' });
        const res2 = await request(makeApp()).post('/index').send({ domain: 'ecommerce', documents: 'oops' });
        expect(res1.status).toBe(400);
        expect(res2.status).toBe(400);
    });

    test('400 when documents array is empty', async () => {
        const res = await request(makeApp()).post('/index').send({ domain: 'ecommerce', documents: [] });
        expect(res.status).toBe(400);
    });
});

describe('index-node app — /index schema check', () => {
    test('404 when domain is unregistered', async () => {
        const res = await request(makeApp()).post('/index').send({
            domain: 'nonexistent',
            documents: [{ id: 'a', title: 'x' }],
        });
        expect(res.status).toBe(404);
    });

    test('does not call indexClient.fanOut when domain unknown', async () => {
        let called = false;
        const app = makeApp({
            indexClient: { fanOut: async () => { called = true; return []; } },
        });
        await request(app).post('/index').send({ domain: 'nope', documents: [{ id: 'a' }] });
        expect(called).toBe(false);
    });
});

describe('index-node app — /index fan-out', () => {
    test('calls indexClient.fanOut with domain and docs', async () => {
        let captured;
        const app = makeApp({
            indexClient: {
                fanOut: async (domain, docs) => {
                    captured = { domain, docs };
                    return [{ node: 'text', ok: true, indexed: docs.length }];
                },
            },
        });

        const docs = [{ id: 'd1', title: 'hello' }, { id: 'd2', title: 'world' }];
        const res = await request(app).post('/index').send({ domain: 'ecommerce', documents: docs });

        expect(res.status).toBe(200);
        expect(captured).toEqual({ domain: 'ecommerce', docs });
    });

    test('response aggregates per-node results and total', async () => {
        const res = await request(makeApp())
            .post('/index')
            .send({ domain: 'ecommerce', documents: [{ id: 'a' }, { id: 'b' }] });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            domain: 'ecommerce',
            received: 2,
            nodeId: 'index-test',
        });
        expect(Array.isArray(res.body.searchNodes)).toBe(true);
        expect(res.body.searchNodes).toHaveLength(3);
    });

    test('207-style mixed success: returns 200 but flags failures in body', async () => {
        const app = makeApp({
            indexClient: {
                fanOut: async (_d, docs) => [
                    { node: 'text', ok: true, indexed: docs.length },
                    { node: 'metadata', ok: false, error: 'connection refused' },
                    { node: 'tags', ok: true, indexed: docs.length },
                ],
            },
        });
        const res = await request(app)
            .post('/index')
            .send({ domain: 'ecommerce', documents: [{ id: 'a' }] });

        expect(res.status).toBe(200);
        const failed = res.body.searchNodes.filter(s => !s.ok);
        expect(failed).toHaveLength(1);
        expect(failed[0].error).toBeDefined();
    });
});
