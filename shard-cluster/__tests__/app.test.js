const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { ShardStore } = require('../storage');
const { createApp } = require('../app');

function freshApp() {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-app-'));
    const store = new ShardStore({ shardCount: 4, baseDir });
    return createApp({ nodeId: 'shard-test', store });
}

describe('Shard Cluster app', () => {
    test('GET /health returns ok', async () => {
        const app = freshApp();
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.service).toBe('shard-cluster');
        expect(res.body.nodeId).toBe('shard-test');
        expect(res.body.shardCount).toBe(4);
    });

    test('PUT /docs stores documents and returns ids', async () => {
        const app = freshApp();
        const res = await request(app)
            .put('/docs')
            .send({
                domain: 'bookstore',
                documents: [
                    { id: 'b1', title: 'Dune' },
                    { id: 'b2', title: 'Foundation' },
                ],
            });
        expect(res.status).toBe(200);
        expect(res.body.domain).toBe('bookstore');
        expect(res.body.stored).toBe(2);
        expect(res.body.ids.sort()).toEqual(['b1', 'b2']);
    });

    test('PUT /docs 400 when domain missing', async () => {
        const app = freshApp();
        const res = await request(app).put('/docs').send({ documents: [{ id: 'x' }] });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/domain/i);
    });

    test('PUT /docs 400 when documents not an array', async () => {
        const app = freshApp();
        const res = await request(app).put('/docs').send({ domain: 'bookstore', documents: 'oops' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/documents/i);
    });

    test('POST /docs/batch-get returns stored docs', async () => {
        const app = freshApp();
        await request(app).put('/docs').send({
            domain: 'bookstore',
            documents: [
                { id: 'b1', title: 'Dune', price: 15 },
                { id: 'b2', title: 'Foundation', price: 12 },
            ],
        });

        const res = await request(app)
            .post('/docs/batch-get')
            .send({ domain: 'bookstore', ids: ['b1', 'b2'] });

        expect(res.status).toBe(200);
        expect(res.body.domain).toBe('bookstore');
        const got = res.body.documents.sort((a, b) => a.id.localeCompare(b.id));
        expect(got).toEqual([
            { id: 'b1', title: 'Dune', price: 15 },
            { id: 'b2', title: 'Foundation', price: 12 },
        ]);
    });

    test('POST /docs/batch-get skips missing ids', async () => {
        const app = freshApp();
        await request(app).put('/docs').send({
            domain: 'bookstore',
            documents: [{ id: 'b1', title: 'Dune' }],
        });

        const res = await request(app)
            .post('/docs/batch-get')
            .send({ domain: 'bookstore', ids: ['b1', 'ghost'] });

        expect(res.status).toBe(200);
        expect(res.body.documents).toEqual([{ id: 'b1', title: 'Dune' }]);
    });

    test('POST /docs/batch-get 400 when domain missing', async () => {
        const app = freshApp();
        const res = await request(app).post('/docs/batch-get').send({ ids: ['b1'] });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/domain/i);
    });

    test('POST /docs/batch-get 400 when ids not an array', async () => {
        const app = freshApp();
        const res = await request(app).post('/docs/batch-get').send({ domain: 'bookstore', ids: 'oops' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/ids/i);
    });
});
