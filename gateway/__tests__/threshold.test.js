const request = require('supertest');
const { app, setSpecialtyClient, setSearchClient } = require('../app');

function fakeSpecialty(nodes) {
    return { route: async () => ({ nodes }) };
}

function fakeSearch() {
    const calls = [];
    return {
        calls,
        search: async (nodeName) => {
            calls.push(nodeName);
            return { results: [] };
        },
    };
}

describe('Gateway — confidence threshold drops low-confidence nodes', () => {
    test('default threshold (0.0) keeps all returned nodes', async () => {
        setSpecialtyClient(fakeSpecialty([
            { name: 'text', confidence: 0.7 },
            { name: 'tags', confidence: 0.4 },
        ]));
        const search = fakeSearch();
        setSearchClient(search);

        await request(app).post('/api/search').send({ domain: 'ecommerce', query: 'red shoes' });
        expect(search.calls.sort()).toEqual(['tags', 'text']);
    });

    test('threshold 0.5 drops the tags node (confidence 0.4)', async () => {
        setSpecialtyClient(fakeSpecialty([
            { name: 'text', confidence: 0.7 },
            { name: 'tags', confidence: 0.4 },
        ]));
        const search = fakeSearch();
        setSearchClient(search);

        await request(app)
            .post('/api/search')
            .send({ domain: 'ecommerce', query: 'red shoes', minConfidence: 0.5 });

        expect(search.calls).toEqual(['text']);
    });

    test('threshold 0.8 drops everything but the highest-confidence node', async () => {
        setSpecialtyClient(fakeSpecialty([
            { name: 'metadata', confidence: 0.9 },
            { name: 'text', confidence: 0.7 },
            { name: 'tags', confidence: 0.4 },
        ]));
        const search = fakeSearch();
        setSearchClient(search);

        await request(app)
            .post('/api/search')
            .send({ domain: 'ecommerce', query: 'red shoes under 500', minConfidence: 0.8 });

        expect(search.calls).toEqual(['metadata']);
    });

    test('threshold above max confidence yields no fan-out', async () => {
        setSpecialtyClient(fakeSpecialty([
            { name: 'text', confidence: 0.7 },
        ]));
        const search = fakeSearch();
        setSearchClient(search);

        const res = await request(app)
            .post('/api/search')
            .send({ domain: 'ecommerce', query: 'red', minConfidence: 0.99 });

        expect(search.calls).toEqual([]);
        expect(res.body.results).toEqual([]);
    });

    test('response routing reflects nodes after threshold filter', async () => {
        setSpecialtyClient(fakeSpecialty([
            { name: 'text', confidence: 0.7 },
            { name: 'tags', confidence: 0.4 },
        ]));
        setSearchClient(fakeSearch());

        const res = await request(app)
            .post('/api/search')
            .send({ domain: 'ecommerce', query: 'red', minConfidence: 0.5 });

        expect(res.body.routing.map(n => n.name)).toEqual(['text']);
    });
});
