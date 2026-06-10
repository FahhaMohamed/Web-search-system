const request = require('supertest');
const { app, setIndexClient } = require('../app');

describe('Gateway POST /api/index', () => {
    test('400 when documents missing', async () => {
        setIndexClient({ index: async () => ({ received: 0, searchNodes: [] }) });
        const res = await request(app).post('/api/index').send({ domain: 'd' });
        expect(res.status).toBe(400);
    });

    test('400 when domain missing', async () => {
        setIndexClient({ index: async () => ({ received: 0, searchNodes: [] }) });
        const res = await request(app).post('/api/index').send({ documents: [{ id: 'a' }] });
        expect(res.status).toBe(400);
    });

    test('forwards domain and documents to IndexClient and returns its response', async () => {
        let captured;
        setIndexClient({
            index: async (domain, documents) => {
                captured = { domain, documents };
                return {
                    domain, received: documents.length, nodeId: 'idx-1',
                    searchNodes: [
                        { node: 'text', ok: true, indexed: documents.length },
                        { node: 'metadata', ok: true, indexed: documents.length },
                        { node: 'tags', ok: true, indexed: documents.length },
                    ],
                };
            },
        });
        const docs = [{ id: 'd1', title: 'red' }, { id: 'd2', title: 'blue' }];
        const res = await request(app).post('/api/index').send({ domain: 'ecommerce', documents: docs });

        expect(res.status).toBe(200);
        expect(captured).toEqual({ domain: 'ecommerce', documents: docs });
        expect(res.body.received).toBe(2);
        expect(res.body.searchNodes).toHaveLength(3);
    });

    test('surfaces 404 from index node when domain is unregistered', async () => {
        setIndexClient({
            index: async () => { const e = new Error('Domain not registered'); e.status = 404; throw e; },
        });
        const res = await request(app).post('/api/index').send({ domain: 'ghost', documents: [{ id: 'a' }] });
        expect(res.status).toBe(404);
    });
});
