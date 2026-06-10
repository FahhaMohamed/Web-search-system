const axios = require('axios');
const request = require('supertest');

const { app: schemaApp, registry } = require('../schema-registry/app');
const {
    app: specialtyApp,
    setSchemaClient: setSpecialtySchemaClient,
} = require('../specialty-node/app');
const { SchemaClient: SpecialtySchemaClient } = require('../specialty-node/schemaClient');

const { createApp: createSearchApp } = require('../search-node/app');
const { SchemaClient: SearchSchemaClient } = require('../search-node/schemaClient');
const { DocStore } = require('../search-node/docStore');

const {
    app: gatewayApp,
    setSpecialtyClient,
    setSearchClient,
} = require('../gateway/app');
const { SpecialtyClient } = require('../gateway/specialtyClient');
const { SearchClient } = require('../gateway/searchClient');

const servers = [];

function listen(app) {
    return new Promise(resolve => {
        const srv = app.listen(0, () => {
            const port = srv.address().port;
            servers.push(srv);
            resolve({ srv, port, url: `http://localhost:${port}` });
        });
    });
}

let schemaSrv, textSrv, metaSrv, tagsSrv, specialtySrv;

beforeAll(async () => {
    registry.storage = { read: () => ({}), write: () => {} };
    registry.schemas.clear();

    schemaSrv = await listen(schemaApp);

    textSrv = await listen(createSearchApp({
        specialty: 'text', nodeId: 'text-1',
        schemaClient: new SearchSchemaClient(schemaSrv.url),
        docStore: new DocStore(),
    }));
    metaSrv = await listen(createSearchApp({
        specialty: 'metadata', nodeId: 'metadata-1',
        schemaClient: new SearchSchemaClient(schemaSrv.url),
        docStore: new DocStore(),
    }));
    tagsSrv = await listen(createSearchApp({
        specialty: 'tags', nodeId: 'tags-1',
        schemaClient: new SearchSchemaClient(schemaSrv.url),
        docStore: new DocStore(),
    }));

    setSpecialtySchemaClient(new SpecialtySchemaClient(schemaSrv.url));
    specialtySrv = await listen(specialtyApp);

    setSpecialtyClient(new SpecialtyClient(specialtySrv.url));
    setSearchClient(new SearchClient({
        text: textSrv.url,
        metadata: metaSrv.url,
        tags: tagsSrv.url,
    }));
});

afterAll(() => {
    for (const srv of servers) srv.close();
});

const SAMPLE_DOCS = [
    { id: 'd1', title: 'red shoes',     description: 'sneakers in red',    price: 250, brand: 'nike',   color: ['red'],   category: ['shoes'] },
    { id: 'd2', title: 'blue boots',    description: 'warm leather boots',  price: 500, brand: 'puma',   color: ['blue'],  category: ['boots'] },
    { id: 'd3', title: 'running shoes', description: 'lightweight runners', price: 100, brand: 'nike',   color: ['red'],   category: ['shoes'] },
    { id: 'd4', title: 'plain hat',     description: 'casual cap',          price: 800, brand: 'adidas', color: ['green'], category: ['hats']  },
];

async function indexAllNodes(domain, docs) {
    await Promise.all([textSrv, metaSrv, tagsSrv].map(s =>
        axios.post(`${s.url}/index`, { domain, documents: docs })
    ));
}

describe('end-to-end: schema registry + specialty + 3 search nodes + gateway', () => {
    test('full pipeline returns weighted results for "red shoes"', async () => {
        await request(schemaApp).post('/schema/ecommerce').send({
            text: ['title', 'description'],
            metadata: ['price', 'brand', 'size'],
            tags: ['color', 'category'],
        });

        await indexAllNodes('ecommerce', SAMPLE_DOCS);

        const res = await request(gatewayApp).post('/api/search').send({
            domain: 'ecommerce', query: 'red shoes',
        });

        expect(res.status).toBe(200);
        const ids = res.body.results.map(r => r.id);
        expect(ids).toEqual(expect.arrayContaining(['d1', 'd3']));
        expect(res.body.routing.map(n => n.name).sort()).toEqual(['tags', 'text']);
    });

    test('query "price<500" routes to metadata only, returns d1+d3', async () => {
        const res = await request(gatewayApp).post('/api/search').send({
            domain: 'ecommerce', query: 'price<500',
        });
        expect(res.body.routing.map(n => n.name)).toEqual(['metadata']);
        const ids = res.body.results.map(r => r.id).sort();
        expect(ids).toEqual(['d1', 'd3']);
    });

    test('query "color:red" routes to tags only', async () => {
        const res = await request(gatewayApp).post('/api/search').send({
            domain: 'ecommerce', query: 'color:red',
        });
        expect(res.body.routing.map(n => n.name)).toEqual(['tags']);
        const ids = res.body.results.map(r => r.id).sort();
        expect(ids).toEqual(['d1', 'd3']);
    });

    test('compound query "red shoes price<500" hits all three', async () => {
        const res = await request(gatewayApp).post('/api/search').send({
            domain: 'ecommerce', query: 'red shoes price<500',
        });
        const routedTo = res.body.routing.map(n => n.name).sort();
        expect(routedTo).toEqual(['metadata', 'tags', 'text']);
        const top = res.body.results[0];
        expect(['d1', 'd3']).toContain(top.id);
        expect(top.sources.length).toBeGreaterThanOrEqual(2);
    });

    test('unknown domain returns 404 from gateway', async () => {
        const res = await request(gatewayApp).post('/api/search').send({
            domain: 'nonexistent', query: 'anything',
        });
        expect(res.status).toBe(404);
    });

    test('minConfidence filter drops weak nodes', async () => {
        const res = await request(gatewayApp).post('/api/search').send({
            domain: 'ecommerce', query: 'red shoes', minConfidence: 0.6,
        });
        expect(res.body.routing.map(n => n.name)).toEqual(['text']);
    });
});
