const express = require('express');
const { runBenchmarkOld } = require('../harness/run-old');

function startMockServer(routes) {
    return new Promise((resolve) => {
        const app = express();
        app.use(express.json());
        const calls = [];
        for (const key of Object.keys(routes)) {
            const [method, p] = key.split(' ');
            app[method.toLowerCase()](p, (req, res) => {
                calls.push({ path: p, query: req.query });
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

describe('runBenchmarkOld (namenode architecture)', () => {
    let searchSrv;

    beforeEach(async () => {
        searchSrv = await startMockServer({
            'GET /search': (req, res) =>
                res.json({ status: true, message: 'ok', results: ['split1.txt', 'split2.txt'] }),
        });
    });

    afterEach(async () => {
        await searchSrv.close();
    });

    test('fires GET /search?q=<word> for each query x repetitions', async () => {
        await runBenchmarkOld({
            searchApiUrl: searchSrv.url,
            queries: ['foo', 'bar'],
            repetitions: 5,
        });
        expect(searchSrv.calls).toHaveLength(10);
        const qs = searchSrv.calls.map((c) => c.query.q);
        expect(qs.filter((q) => q === 'foo')).toHaveLength(5);
        expect(qs.filter((q) => q === 'bar')).toHaveLength(5);
    });

    test('returns one row per (query, repetition) with the expected fields', async () => {
        const rows = await runBenchmarkOld({
            searchApiUrl: searchSrv.url,
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
        const rows = await runBenchmarkOld({
            searchApiUrl: searchSrv.url,
            queries: ['foo'],
            repetitions: 3,
        });
        for (const r of rows) {
            expect(typeof r.latencyMs).toBe('number');
            expect(r.latencyMs).toBeGreaterThan(0);
        }
    });

    test('records result count from response', async () => {
        const rows = await runBenchmarkOld({
            searchApiUrl: searchSrv.url,
            queries: ['foo'],
            repetitions: 2,
        });
        for (const r of rows) expect(r.resultCount).toBe(2);
    });

    test('records empty result correctly (zero hits is not an error)', async () => {
        await searchSrv.close();
        searchSrv = await startMockServer({
            'GET /search': (req, res) =>
                res.json({ status: true, message: 'No results found.', results: [] }),
        });
        const rows = await runBenchmarkOld({
            searchApiUrl: searchSrv.url,
            queries: ['nothing'],
            repetitions: 2,
        });
        for (const r of rows) {
            expect(r.resultCount).toBe(0);
            expect(r.status).toBe('ok');
        }
    });

    test('records status=error on HTTP failure, keeps going', async () => {
        await searchSrv.close();
        searchSrv = await startMockServer({
            'GET /search': (req, res) => res.status(500).json({ error: 'boom' }),
        });
        const rows = await runBenchmarkOld({
            searchApiUrl: searchSrv.url,
            queries: ['foo'],
            repetitions: 3,
        });
        expect(rows).toHaveLength(3);
        for (const r of rows) expect(r.status).toBe('error');
    });

    test('calls onProgress callback during run', async () => {
        const events = [];
        await runBenchmarkOld({
            searchApiUrl: searchSrv.url,
            queries: ['foo'],
            repetitions: 2,
            onProgress: (e) => events.push(e),
        });
        expect(events.length).toBeGreaterThan(0);
    });
});
