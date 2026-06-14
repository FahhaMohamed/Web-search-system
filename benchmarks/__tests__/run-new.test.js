const express = require('express');
const { runBenchmark } = require('../harness/run-new');

function startMockServer(routes) {
    return new Promise((resolve) => {
        const app = express();
        app.use(express.json({ limit: '50mb' }));
        const calls = [];
        for (const key of Object.keys(routes)) {
            const [method, p] = key.split(' ');
            app[method.toLowerCase()](p, (req, res) => {
                calls.push({ path: p, body: req.body, params: req.params });
                routes[key](req, res);
            });
        }
        const server = app.listen(0, () => {
            resolve({
                url: `http://localhost:${server.address().port}`,
                calls,
                close: () => new Promise((r) => server.close(r)),
            });
        });
    });
}

const SCHEMA = { text: ['title'], metadata: [], tags: [] };
const DOC = { id: 'p-1', title: 'foo' };

describe('runBenchmark (new architecture)', () => {
    let schemaSrv, gatewaySrv;

    beforeEach(async () => {
        schemaSrv = await startMockServer({
            'POST /schema/:domain': (req, res) => res.json({ ok: true }),
        });
        gatewaySrv = await startMockServer({
            'POST /api/index': (req, res) => res.json({ received: req.body.documents?.length || 0, searchNodes: [] }),
            'POST /api/search': (req, res) => res.json({ results: [{ id: 'p-0', score: 1 }], routing: [] }),
        });
    });

    afterEach(async () => {
        await schemaSrv.close();
        await gatewaySrv.close();
    });

    test('registers the schema once with the right payload', async () => {
        await runBenchmark({
            schemaRegistryUrl: schemaSrv.url,
            gatewayUrl: gatewaySrv.url,
            domain: 'products',
            schema: SCHEMA,
            documents: [DOC],
            queries: ['foo'],
            repetitions: 1,
        });
        const schemaCalls = schemaSrv.calls.filter((c) => c.path === '/schema/:domain');
        expect(schemaCalls).toHaveLength(1);
        expect(schemaCalls[0].body).toEqual(SCHEMA);
    });

    test('indexes all documents in batches', async () => {
        const docs = Array.from({ length: 2500 }, (_, i) => ({ id: `p-${i}`, title: `t-${i}` }));
        await runBenchmark({
            schemaRegistryUrl: schemaSrv.url,
            gatewayUrl: gatewaySrv.url,
            domain: 'products',
            schema: SCHEMA,
            documents: docs,
            queries: ['t-0'],
            repetitions: 1,
            batchSize: 1000,
        });
        const indexCalls = gatewaySrv.calls.filter((c) => c.path === '/api/index');
        expect(indexCalls).toHaveLength(3);
        expect(indexCalls[0].body.documents).toHaveLength(1000);
        expect(indexCalls[2].body.documents).toHaveLength(500);
    });

    test('fires each query the requested number of repetitions', async () => {
        await runBenchmark({
            schemaRegistryUrl: schemaSrv.url,
            gatewayUrl: gatewaySrv.url,
            domain: 'products',
            schema: SCHEMA,
            documents: [DOC],
            queries: ['foo', 'bar'],
            repetitions: 5,
        });
        const searchCalls = gatewaySrv.calls.filter((c) => c.path === '/api/search');
        expect(searchCalls).toHaveLength(10);
    });

    test('returns one row per (query, repetition) with the expected fields', async () => {
        const { rows } = await runBenchmark({
            schemaRegistryUrl: schemaSrv.url,
            gatewayUrl: gatewaySrv.url,
            domain: 'products',
            schema: SCHEMA,
            documents: [DOC],
            queries: ['foo', 'bar', 'baz'],
            repetitions: 4,
        });
        expect(rows).toHaveLength(12);
        for (const r of rows) {
            expect(r).toHaveProperty('query');
            expect(r).toHaveProperty('repetition');
            expect(r).toHaveProperty('latencyMs');
            expect(r).toHaveProperty('resultCount');
            expect(r).toHaveProperty('status');
        }
    });

    test('records latency as a positive number', async () => {
        const { rows } = await runBenchmark({
            schemaRegistryUrl: schemaSrv.url,
            gatewayUrl: gatewaySrv.url,
            domain: 'products',
            schema: SCHEMA,
            documents: [DOC],
            queries: ['foo'],
            repetitions: 3,
        });
        for (const r of rows) {
            expect(typeof r.latencyMs).toBe('number');
            expect(r.latencyMs).toBeGreaterThan(0);
        }
    });

    test('records result count from the response', async () => {
        await gatewaySrv.close();
        gatewaySrv = await startMockServer({
            'POST /api/index': (req, res) => res.json({ received: 1, searchNodes: [] }),
            'POST /api/search': (req, res) =>
                res.json({ results: [{ id: 'p-0' }, { id: 'p-1' }, { id: 'p-2' }], routing: [] }),
        });
        const { rows } = await runBenchmark({
            schemaRegistryUrl: schemaSrv.url,
            gatewayUrl: gatewaySrv.url,
            domain: 'products',
            schema: SCHEMA,
            documents: [DOC],
            queries: ['foo'],
            repetitions: 2,
        });
        for (const r of rows) expect(r.resultCount).toBe(3);
    });

    test('records status=error when search fails, keeps going', async () => {
        await gatewaySrv.close();
        gatewaySrv = await startMockServer({
            'POST /api/index': (req, res) => res.json({ received: 1, searchNodes: [] }),
            'POST /api/search': (req, res) => res.status(500).json({ error: 'boom' }),
        });
        const { rows } = await runBenchmark({
            schemaRegistryUrl: schemaSrv.url,
            gatewayUrl: gatewaySrv.url,
            domain: 'products',
            schema: SCHEMA,
            documents: [DOC],
            queries: ['foo'],
            repetitions: 3,
        });
        expect(rows).toHaveLength(3);
        for (const r of rows) expect(r.status).toBe('error');
    });

    test('returns indexingMs alongside rows', async () => {
        const result = await runBenchmark({
            schemaRegistryUrl: schemaSrv.url,
            gatewayUrl: gatewaySrv.url,
            domain: 'products',
            schema: SCHEMA,
            documents: [DOC],
            queries: ['foo'],
            repetitions: 1,
        });
        expect(result).toHaveProperty('rows');
        expect(result).toHaveProperty('indexingMs');
        expect(Array.isArray(result.rows)).toBe(true);
        expect(typeof result.indexingMs).toBe('number');
        expect(result.indexingMs).toBeGreaterThanOrEqual(0);
    });

    test('calls onProgress callback during run', async () => {
        const events = [];
        await runBenchmark({
            schemaRegistryUrl: schemaSrv.url,
            gatewayUrl: gatewaySrv.url,
            domain: 'products',
            schema: SCHEMA,
            documents: [DOC],
            queries: ['foo'],
            repetitions: 2,
            onProgress: (e) => events.push(e),
        });
        expect(events.length).toBeGreaterThan(0);
    });
});
