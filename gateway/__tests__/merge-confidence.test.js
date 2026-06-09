const request = require('supertest');
const { app, setSpecialtyClient, setSearchClient } = require('../app');

function fakeSpecialty(nodes) {
    return { route: async () => ({ nodes }) };
}

function fakeSearchWithResults(resultsByNode) {
    return {
        search: async (nodeName) => ({ results: resultsByNode[nodeName] || [] }),
    };
}

async function search(domain, query) {
    return request(app).post('/api/search').send({ domain, query });
}

describe('Gateway — merge & rank uses node confidence as weight', () => {
    test('same raw score: higher-confidence node ranks higher', async () => {
        setSpecialtyClient(fakeSpecialty([
            { name: 'text', confidence: 0.7 },
            { name: 'tags', confidence: 0.4 },
        ]));
        setSearchClient(fakeSearchWithResults({
            text: [{ id: 'A', score: 1.0 }],
            tags: [{ id: 'B', score: 1.0 }],
        }));

        const res = await search('ecommerce', 'red shoes');
        expect(res.status).toBe(200);
        const ids = res.body.results.map(r => r.id);
        expect(ids).toEqual(['A', 'B']);
        expect(res.body.results[0].score).toBeCloseTo(0.7);
        expect(res.body.results[1].score).toBeCloseTo(0.4);
    });

    test('same document from two nodes: weighted scores sum', async () => {
        setSpecialtyClient(fakeSpecialty([
            { name: 'text', confidence: 0.7 },
            { name: 'tags', confidence: 0.4 },
        ]));
        setSearchClient(fakeSearchWithResults({
            text: [{ id: 'X', score: 1.0 }],
            tags: [{ id: 'X', score: 1.0 }],
        }));

        const res = await search('ecommerce', 'red');
        expect(res.body.results).toHaveLength(1);
        expect(res.body.results[0].id).toBe('X');
        expect(res.body.results[0].score).toBeCloseTo(1.1);
        expect(res.body.results[0].sources).toEqual(expect.arrayContaining(['text', 'tags']));
    });

    test('confidence 1.0 leaves score unchanged', async () => {
        setSpecialtyClient(fakeSpecialty([{ name: 'metadata', confidence: 1.0 }]));
        setSearchClient(fakeSearchWithResults({
            metadata: [{ id: 'M', score: 2.5 }],
        }));

        const res = await search('ecommerce', 'price<500');
        expect(res.body.results[0].score).toBeCloseTo(2.5);
    });

    test('routing array is echoed in response', async () => {
        const routing = [
            { name: 'text', confidence: 0.7 },
            { name: 'metadata', confidence: 0.9 },
        ];
        setSpecialtyClient(fakeSpecialty(routing));
        setSearchClient(fakeSearchWithResults({ text: [], metadata: [] }));

        const res = await search('ecommerce', 'red shoes 500');
        expect(res.body.routing).toEqual(routing);
    });
});
