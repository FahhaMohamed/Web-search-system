const express = require('express');
const { IndexClient, projectDocs } = require('../indexClient');

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

describe('projectDocs', () => {
    test('keeps only id plus listed fields', () => {
        const docs = [
            { id: 'a', title: 'hi', price: 9, color: 'red' },
            { id: 'b', title: 'yo', price: 5, color: 'blue' },
        ];
        expect(projectDocs(docs, ['title'])).toEqual([
            { id: 'a', title: 'hi' },
            { id: 'b', title: 'yo' },
        ]);
    });

    test('keeps id only when fields list is empty', () => {
        expect(projectDocs([{ id: 'a', title: 'x' }], [])).toEqual([{ id: 'a' }]);
    });

    test('skips fields not present on the doc', () => {
        expect(projectDocs([{ id: 'a', title: 'x' }], ['title', 'missing'])).toEqual([{ id: 'a', title: 'x' }]);
    });
});

describe('IndexClient.fanOut', () => {
    test('projects per-specialty before POSTing to each search node', async () => {
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
        const schema = { text: ['title'], metadata: ['price'], tags: ['color'] };
        const docs = [
            { id: 'a', title: 'red shoes', price: 9, color: 'red' },
            { id: 'b', title: 'blue boots', price: 5, color: 'blue' },
        ];

        const out = await client.fanOut('ecommerce', docs, schema);

        expect(received.text.documents).toEqual([
            { id: 'a', title: 'red shoes' },
            { id: 'b', title: 'blue boots' },
        ]);
        expect(received.metadata.documents).toEqual([
            { id: 'a', price: 9 },
            { id: 'b', price: 5 },
        ]);
        expect(received.tags.documents).toEqual([
            { id: 'a', color: 'red' },
            { id: 'b', color: 'blue' },
        ]);

        const byName = Object.fromEntries(out.map(r => [r.node, r]));
        expect(byName.text).toMatchObject({ node: 'text', ok: true, indexed: 2 });
        expect(byName.metadata).toMatchObject({ node: 'metadata', ok: true, indexed: 2 });
        expect(byName.tags).toMatchObject({ node: 'tags', ok: true, indexed: 2 });
    });

    test('sends id-only payload to a node whose specialty is missing from the schema', async () => {
        let tagsReceived = null;
        const text = await listenFake((req, res) => res.json({ indexed: req.body.documents.length }));
        const metadata = await listenFake((req, res) => res.json({ indexed: req.body.documents.length }));
        const tags = await listenFake((req, res) => {
            tagsReceived = req.body;
            res.json({ indexed: req.body.documents.length });
        });

        const client = new IndexClient({ text: text.url, metadata: metadata.url, tags: tags.url });
        const schema = { text: ['message'], metadata: ['level'] };
        const docs = [{ id: 'x', message: 'hello', level: 'info', extra: 'unused' }];

        await client.fanOut('logs', docs, schema);

        expect(tagsReceived.documents).toEqual([{ id: 'x' }]);
    });

    test('reports per-node errors without throwing', async () => {
        const text = await listenFake((req, res) => res.json({ indexed: 1 }));
        const metadata = await listenFake((req, res) => res.status(500).json({ error: 'boom' }));

        const client = new IndexClient({
            text: text.url,
            metadata: metadata.url,
            tags: 'http://127.0.0.1:1',
        });

        const schema = { text: ['t'], metadata: ['m'], tags: ['g'] };
        const out = await client.fanOut('d', [{ id: 'x' }], schema);
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
        const schema = { text: ['t'], metadata: ['m'], tags: ['g'] };
        const start = Date.now();
        await client.fanOut('d', [{ id: 'x' }], schema);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(400);
    });
});
