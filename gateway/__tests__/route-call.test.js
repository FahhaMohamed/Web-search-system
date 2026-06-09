const request = require('supertest');
const { app, setSpecialtyClient, setSearchClient } = require('../app');

function makeFakeSpecialty() {
    const calls = [];
    return {
        calls,
        route: async (domain, query) => {
            calls.push({ domain, query });
            return { nodes: [{ name: 'text', confidence: 0.7 }] };
        },
    };
}

function makeFakeSearch() {
    const calls = [];
    return {
        calls,
        search: async (nodeName, { domain, query }) => {
            calls.push({ nodeName, domain, query });
            return { results: [] };
        },
    };
}

describe('Gateway — calls Specialty Node before fan-out', () => {
    test('POST /api/search calls Specialty Node /route with domain + query', async () => {
        const specialty = makeFakeSpecialty();
        const search = makeFakeSearch();
        setSpecialtyClient(specialty);
        setSearchClient(search);

        const res = await request(app)
            .post('/api/search')
            .send({ domain: 'ecommerce', query: 'red shoes' });

        expect(res.status).toBe(200);
        expect(specialty.calls).toEqual([{ domain: 'ecommerce', query: 'red shoes' }]);
    });

    test('returns 400 when query missing', async () => {
        const res = await request(app)
            .post('/api/search')
            .send({ domain: 'ecommerce' });
        expect(res.status).toBe(400);
    });

    test('propagates 404 when Specialty Node says domain not found', async () => {
        setSpecialtyClient({
            route: async () => { const e = new Error('Domain not found'); e.status = 404; throw e; },
        });
        setSearchClient(makeFakeSearch());

        const res = await request(app)
            .post('/api/search')
            .send({ domain: 'nonexistent', query: 'anything' });
        expect(res.status).toBe(404);
    });
});
