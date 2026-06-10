const express = require('express');
const { IndexClient } = require('../indexClient');

const servers = [];

function listenFake(handler) {
    const app = express();
    app.use(express.json());
    app.post('/index', handler);
    return new Promise(resolve => {
        const srv = app.listen(0, () => {
            const port = srv.address().port;
            servers.push(srv);
            resolve({ url: `http://localhost:${port}`, srv });
        });
    });
}

afterAll(() => {
    for (const s of servers) s.close();
});

describe('IndexClient.fanOut', () => {
    test('POSTs the same body to every configured search node', async () => {
        const received = { text: null, metadata: null, tags: null };

        const text = await listenFake((req, res) => {
            received.text = req.body;
            res.json({ specialty: 'text', indexed: req.body.documents.length });
        });
        const metadata = await listenFake((req, res) => {
            received.metadata = req.body;
            res.json({ specialty: 'metadata', indexed: req.body.documents.length });
        });
        const tags = await listenFake((req, res) => {
            received.tags = req.body;
            res.json({ specialty: 'tags', indexed: req.body.documents.length });
        });

        const client = new IndexClient({ text: text.url, metadata: metadata.url, tags: tags.url });
        const docs = [{ id: 'a', title: 'red shoes' }, { id: 'b', title: 'blue boots' }];

        const out = await client.fanOut('ecommerce', docs);

        expect(received.text).toEqual({ domain: 'ecommerce', documents: docs });
        expect(received.metadata).toEqual({ domain: 'ecommerce', documents: docs });
        expect(received.tags).toEqual({ domain: 'ecommerce', documents: docs });

        const byName = Object.fromEntries(out.map(r => [r.node, r]));
        expect(byName.text).toMatchObject({ node: 'text', ok: true, indexed: 2 });
        expect(byName.metadata).toMatchObject({ node: 'metadata', ok: true, indexed: 2 });
        expect(byName.tags).toMatchObject({ node: 'tags', ok: true, indexed: 2 });
    });

    test('reports per-node errors without throwing', async () => {
        const text = await listenFake((req, res) => res.json({ indexed: 1 }));
        const metadata = await listenFake((req, res) => res.status(500).json({ error: 'boom' }));

        const client = new IndexClient({
            text: text.url,
            metadata: metadata.url,
            tags: 'http://127.0.0.1:1',
        });

        const out = await client.fanOut('d', [{ id: 'x' }]);
        const byName = Object.fromEntries(out.map(r => [r.node, r]));

        expect(byName.text.ok).toBe(true);
        expect(byName.metadata.ok).toBe(false);
        expect(byName.metadata.error).toBeDefined();
        expect(byName.tags.ok).toBe(false);
        expect(byName.tags.error).toBeDefined();
    });

    test('runs requests in parallel (total time ~ slowest, not sum)', async () => {
        const slow = (ms) => listenFake(async (req, res) => {
            await new Promise(r => setTimeout(r, ms));
            res.json({ indexed: 1 });
        });

        const a = await slow(150);
        const b = await slow(150);
        const c = await slow(150);

        const client = new IndexClient({ text: a.url, metadata: b.url, tags: c.url });
        const start = Date.now();
        await client.fanOut('d', [{ id: 'x' }]);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(400);
    });
});
