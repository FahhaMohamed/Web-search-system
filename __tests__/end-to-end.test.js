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
    setIndexClient: setGatewayIndexClient,
    setShardClient: setGatewayShardClient,
} = require('../gateway/app');
const { SpecialtyClient } = require('../gateway/specialtyClient');
const { SearchClient } = require('../gateway/searchClient');
const { IndexClient: GatewayIndexClient } = require('../gateway/indexClient');
const { ShardClient: GatewayShardClient } = require('../gateway/shardClient');

const { createApp: createIndexApp } = require('../index-node/app');
const { SchemaClient: IndexSchemaClient } = require('../index-node/schemaClient');
const { IndexClient: NodeIndexClient } = require('../index-node/indexClient');
const { ShardClient: IndexShardClient } = require('../index-node/shardClient');

const { createApp: createShardApp } = require('../shard-cluster/app');
const { ShardStore } = require('../shard-cluster/storage');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

let schemaSrv, textSrv, metaSrv, tagsSrv, specialtySrv, indexSrv, shardSrv;

beforeAll(async () => {
    registry.storage = { read: () => ({}), write: () => {} };
    registry.schemas.clear();

    schemaSrv = await listen(schemaApp);

    const shardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-shard-'));
    shardSrv = await listen(createShardApp({
        nodeId: 'shard-e2e',
        store: new ShardStore({ shardCount: 4, baseDir: shardDir }),
    }));

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

    indexSrv = await listen(createIndexApp({
        nodeId: 'index-1',
        schemaClient: new IndexSchemaClient(schemaSrv.url),
        indexClient: new NodeIndexClient({
            text: textSrv.url,
            metadata: metaSrv.url,
            tags: tagsSrv.url,
        }),
        shardClient: new IndexShardClient(shardSrv.url),
    }));

    setSpecialtyClient(new SpecialtyClient(specialtySrv.url));
    setSearchClient(new SearchClient({
        text: textSrv.url,
        metadata: metaSrv.url,
        tags: tagsSrv.url,
    }));
    setGatewayIndexClient(new GatewayIndexClient(indexSrv.url));
    setGatewayShardClient(new GatewayShardClient(shardSrv.url));
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
    await axios.put(`${shardSrv.url}/docs`, { domain, documents: docs });
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

    test('Gateway hydrates full doc fields from Shard Cluster (title, price, etc.)', async () => {
        const res = await request(gatewayApp).post('/api/search').send({
            domain: 'ecommerce', query: 'red shoes',
        });

        expect(res.status).toBe(200);
        const d1 = res.body.results.find(r => r.id === 'd1');
        expect(d1).toBeDefined();
        expect(d1.title).toBe('red shoes');
        expect(d1.price).toBe(250);
        expect(typeof d1.score).toBe('number');
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

describe('end-to-end STORE path: Gateway -> Index Node -> 3 Search Nodes', () => {
    test('docs indexed via Gateway /api/index become searchable via /api/search', async () => {
        await request(schemaApp).post('/schema/recipes').send({
            text: ['title', 'instructions'],
            metadata: ['calories', 'prepTime'],
            tags: ['cuisine', 'diet'],
        });

        const recipes = [
            { id: 'r1', title: 'pasta carbonara', instructions: 'boil water', calories: 600, prepTime: 20, cuisine: ['italian'], diet: ['none'] },
            { id: 'r2', title: 'green salad',     instructions: 'chop greens', calories: 150, prepTime: 5,  cuisine: ['mediterranean'], diet: ['vegan'] },
        ];

        const indexRes = await request(gatewayApp).post('/api/index').send({
            domain: 'recipes', documents: recipes,
        });

        expect(indexRes.status).toBe(200);
        expect(indexRes.body.received).toBe(2);
        expect(indexRes.body.searchNodes).toHaveLength(3);
        expect(indexRes.body.searchNodes.every(s => s.ok)).toBe(true);

        const searchRes = await request(gatewayApp).post('/api/search').send({
            domain: 'recipes', query: 'pasta',
        });
        expect(searchRes.status).toBe(200);
        expect(searchRes.body.results.map(r => r.id)).toContain('r1');
    });

    test('Gateway /api/index returns 404 when domain is not registered', async () => {
        const res = await request(gatewayApp).post('/api/index').send({
            domain: 'ghost-domain', documents: [{ id: 'x', title: 'nope' }],
        });
        expect(res.status).toBe(404);
    });

    test('Gateway /api/index returns 400 when documents missing', async () => {
        const res = await request(gatewayApp).post('/api/index').send({ domain: 'recipes' });
        expect(res.status).toBe(400);
    });
});

describe('end-to-end: domain-agnostic — third domain (movies) goes through new hydration path', () => {
    test('register schema, index, search, get hydrated results', async () => {
        await request(schemaApp).post('/schema/movies').send({
            text: ['title', 'plot'],
            metadata: ['rating', 'year', 'runtime'],
            tags: ['genre', 'director'],
        });

        const movies = [
            { id: 'm1', title: 'Inception',       plot: 'dreams within dreams',     rating: 8.8, year: 2010, runtime: 148, genre: ['scifi'],  director: ['nolan']    },
            { id: 'm2', title: 'The Godfather',   plot: 'mafia family saga',         rating: 9.2, year: 1972, runtime: 175, genre: ['crime'],  director: ['coppola']  },
            { id: 'm3', title: 'Interstellar',    plot: 'space and time travel',     rating: 8.6, year: 2014, runtime: 169, genre: ['scifi'],  director: ['nolan']    },
        ];

        const indexRes = await request(gatewayApp).post('/api/index').send({
            domain: 'movies', documents: movies,
        });
        expect(indexRes.status).toBe(200);
        expect(indexRes.body.received).toBe(3);
        expect(indexRes.body.shardCluster).toMatchObject({ ok: true, stored: 3 });
        expect(indexRes.body.searchNodes.every(s => s.ok)).toBe(true);

        const textRes = await request(gatewayApp).post('/api/search').send({
            domain: 'movies', query: 'dreams',
        });
        const m1 = textRes.body.results.find(r => r.id === 'm1');
        expect(m1).toBeDefined();
        expect(m1.title).toBe('Inception');
        expect(m1.year).toBe(2010);

        const metaRes = await request(gatewayApp).post('/api/search').send({
            domain: 'movies', query: 'year>2000',
        });
        expect(metaRes.body.routing.map(n => n.name)).toEqual(['metadata']);
        const newer = metaRes.body.results.map(r => r.id).sort();
        expect(newer).toEqual(['m1', 'm3']);

        const tagRes = await request(gatewayApp).post('/api/search').send({
            domain: 'movies', query: 'director:nolan',
        });
        expect(tagRes.body.routing.map(n => n.name)).toEqual(['tags']);
        const byNolan = tagRes.body.results.map(r => r.id).sort();
        expect(byNolan).toEqual(['m1', 'm3']);
        const nolanFirst = tagRes.body.results[0];
        expect(nolanFirst.director).toEqual(['nolan']);

        const compoundRes = await request(gatewayApp).post('/api/search').send({
            domain: 'movies', query: 'space genre:scifi year over 2010',
        });
        const routed = compoundRes.body.routing.map(n => n.name).sort();
        expect(routed).toEqual(expect.arrayContaining(['metadata', 'tags', 'text']));
        const top = compoundRes.body.results[0];
        expect(top.id).toBe('m3');
        expect(top.title).toBe('Interstellar');
    });
});
