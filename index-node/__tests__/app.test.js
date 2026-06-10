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
    const shardClient = stubs.shardClient || {
        putDocs: async (_domain, docs) => ({ ok: true, stored: docs.length, ids: docs.map(d => d.id) }),
    };
    return createApp({ nodeId: 'index-test', schemaClient, indexClient, shardClient });
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

    test('writes docs to Shard Cluster BEFORE fanning out to search nodes', async () => {
        const order = [];
        const app = makeApp({
            shardClient: { putDocs: async (_d, docs) => { order.push('shard'); return { ok: true, stored: docs.length, ids: docs.map(d => d.id) }; } },
            indexClient: { fanOut: async (_d, docs) => { order.push('fanout'); return [{ node: 'text', ok: true, indexed: docs.length }]; } },
        });

        await request(app).post('/index').send({ domain: 'ecommerce', documents: [{ id: 'a' }] });

        expect(order).toEqual(['shard', 'fanout']);
    });

    test('response body includes shard ack', async () => {
        const res = await request(makeApp())
            .post('/index')
            .send({ domain: 'ecommerce', documents: [{ id: 'a' }, { id: 'b' }] });

        expect(res.status).toBe(200);
        expect(res.body.shardCluster).toMatchObject({ ok: true, stored: 2 });
    });

    test('does not fan-out when Shard Cluster write fails', async () => {
        let fanoutCalled = false;
        const app = makeApp({
            shardClient: { putDocs: async () => ({ ok: false, error: 'shard down' }) },
            indexClient: { fanOut: async () => { fanoutCalled = true; return []; } },
        });

        const res = await request(app).post('/index').send({ domain: 'ecommerce', documents: [{ id: 'a' }] });

        expect(fanoutCalled).toBe(false);
        expect(res.status).toBe(502);
        expect(res.body.error).toMatch(/shard/i);
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
