const request = require('supertest');
const { app, setSpecialtyClient, setSearchClient } = require('../app');

function fakeSpecialty(nodes) {
    return { route: async () => ({ nodes }) };
}

function fakeSearch() {
    const calls = [];
    return {
        calls,
        search: async (nodeName, payload) => {
            calls.push({ nodeName, ...payload });
            return { results: [] };
        },
    };
}

describe('Gateway — fan-out targets only Specialty Node-returned nodes', () => {
    test('only tags node is called when Specialty returns [tags]', async () => {
        setSpecialtyClient(fakeSpecialty([{ name: 'tags', confidence: 1.0 }]));
        const search = fakeSearch();
        setSearchClient(search);

        await request(app).post('/api/search').send({ domain: 'ecommerce', query: '#summer' });

        expect(search.calls.map(c => c.nodeName)).toEqual(['tags']);
    });

    test('text + metadata called when Specialty returns those two', async () => {
        setSpecialtyClient(fakeSpecialty([
            { name: 'text', confidence: 0.7 },
            { name: 'metadata', confidence: 0.9 },
        ]));
        const search = fakeSearch();
        setSearchClient(search);

        await request(app).post('/api/search').send({ domain: 'ecommerce', query: 'red shoes 500' });

        const called = search.calls.map(c => c.nodeName).sort();
        expect(called).toEqual(['metadata', 'text']);
    });

    test('no fan-out when Specialty returns empty nodes list', async () => {
        setSpecialtyClient(fakeSpecialty([]));
        const search = fakeSearch();
        setSearchClient(search);

        await request(app).post('/api/search').send({ domain: 'ecommerce', query: '' });

        expect(search.calls).toEqual([]);
    });

    test('each search call receives domain + query + filters', async () => {
        setSpecialtyClient(fakeSpecialty([{ name: 'text', confidence: 0.7 }]));
        const search = fakeSearch();
        setSearchClient(search);

        await request(app)
            .post('/api/search')
            .send({ domain: 'logs', query: 'error', filters: { since: '2020' } });

        expect(search.calls[0]).toMatchObject({
            nodeName: 'text',
            domain: 'logs',
            query: 'error',
            filters: { since: '2020' },
        });
    });
});
