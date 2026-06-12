#!/usr/bin/env node
/**
 * Smoke test for the live docker-compose stack.
 * Runs end-to-end against the running containers (not in-process).
 *
 * Usage:
 *   docker compose up --build -d
 *   node scripts/smoke.js
 *
 * Exit codes:
 *   0 -- all assertions passed
 *   1 -- one or more assertions failed
 */

const axios = require('axios');

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3000';
const SCHEMA_REGISTRY = process.env.SCHEMA_REGISTRY_URL || 'http://localhost:5000';
const SHARD_CLUSTER = process.env.SHARD_CLUSTER_URL || 'http://localhost:7000';
const DOMAIN = 'recipes';

let failures = 0;

function assert(label, cond, detail) {
    if (cond) {
        console.log(`  PASS  ${label}`);
    } else {
        console.log(`  FAIL  ${label}`);
        if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
        failures++;
    }
}

async function waitForHealth(name, url, retries = 30) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios.get(url, { timeout: 2000 });
            if (res.status === 200) return true;
        } catch (_) { /* not ready */ }
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error(`${name} never became healthy at ${url}`);
}

async function main() {
    console.log(`\n== Smoke test against ${GATEWAY} ==\n`);

    console.log('Waiting for services to be ready...');
    await waitForHealth('schema-registry', `${SCHEMA_REGISTRY}/health`);
    await waitForHealth('shard-cluster',   `${SHARD_CLUSTER}/health`);
    await waitForHealth('gateway',         `${GATEWAY}/api/health`);
    console.log('Services healthy.\n');

    // -- Step 1: register a recipes schema (domain-agnostic proof: NOT ecommerce) --
    console.log('1) Register schema for "recipes"');
    await axios.post(`${SCHEMA_REGISTRY}/schema/${DOMAIN}`, {
        text:     ['title', 'instructions'],
        metadata: ['calories', 'prepTime'],
        tags:     ['cuisine', 'diet'],
    });
    const schemaRes = await axios.get(`${SCHEMA_REGISTRY}/schema/${DOMAIN}`);
    assert('schema registered', schemaRes.data.schema.text.includes('title'));

    // -- Step 2: index docs via Gateway --
    console.log('\n2) Index 4 recipes via Gateway /api/index');
    const recipes = [
        { id: 'r1', title: 'pasta carbonara',  instructions: 'boil water then mix eggs', calories: 600, prepTime: 20, cuisine: ['italian'],       diet: ['none']       },
        { id: 'r2', title: 'green salad',      instructions: 'chop greens',              calories: 150, prepTime: 5,  cuisine: ['mediterranean'], diet: ['vegan']      },
        { id: 'r3', title: 'spicy chicken',    instructions: 'grill chicken with spice', calories: 450, prepTime: 30, cuisine: ['indian'],        diet: ['none']       },
        { id: 'r4', title: 'avocado toast',    instructions: 'toast bread spread avocado', calories: 250, prepTime: 10, cuisine: ['american'],      diet: ['vegetarian'] },
    ];

    const indexRes = await axios.post(`${GATEWAY}/api/index`, { domain: DOMAIN, documents: recipes });
    assert('indexed all 4 docs', indexRes.data.received === 4, indexRes.data);
    assert('all 3 search nodes ack ok', indexRes.data.searchNodes.every(s => s.ok), indexRes.data.searchNodes);

    // -- Step 3: text query --
    console.log('\n3) Text search "pasta"');
    const textRes = await axios.post(`${GATEWAY}/api/search`, { domain: DOMAIN, query: 'pasta' });
    const textIds = textRes.data.results.map(r => r.id);
    assert('text result contains r1', textIds.includes('r1'), textIds);
    assert('routing includes text node', textRes.data.routing.some(n => n.name === 'text'), textRes.data.routing);

    const r1 = textRes.data.results.find(r => r.id === 'r1');
    assert('result is hydrated with full doc from Shard Cluster (title)', r1 && r1.title === 'pasta carbonara', r1);
    assert('result is hydrated with full doc from Shard Cluster (calories)', r1 && r1.calories === 600, r1);

    // -- Step 4: metadata query --
    console.log('\n4) Metadata search "calories<300"');
    const metaRes = await axios.post(`${GATEWAY}/api/search`, { domain: DOMAIN, query: 'calories<300' });
    const metaIds = metaRes.data.results.map(r => r.id).sort();
    assert('metadata returns r2 and r4 (low calorie)', JSON.stringify(metaIds) === JSON.stringify(['r2', 'r4']), metaIds);
    assert('routing includes metadata node only', metaRes.data.routing.length === 1 && metaRes.data.routing[0].name === 'metadata', metaRes.data.routing);

    // -- Step 5: tags query --
    console.log('\n5) Tags search "cuisine:italian"');
    const tagRes = await axios.post(`${GATEWAY}/api/search`, { domain: DOMAIN, query: 'cuisine:italian' });
    const tagIds = tagRes.data.results.map(r => r.id);
    assert('tags returns r1', tagIds.includes('r1'), tagIds);
    assert('routing includes tags node only', tagRes.data.routing.length === 1 && tagRes.data.routing[0].name === 'tags', tagRes.data.routing);

    // -- Step 6: natural-language metadata query --
    console.log('\n6) Natural-language search "spicy chicken prepTime under 35"');
    const nlRes = await axios.post(`${GATEWAY}/api/search`, { domain: DOMAIN, query: 'spicy chicken prepTime under 35' });
    const nlIds = nlRes.data.results.map(r => r.id);
    assert('compound query returns r3', nlIds.includes('r3'), nlIds);
    const routed = nlRes.data.routing.map(n => n.name).sort();
    assert('compound query routed to text+metadata', routed.includes('text') && routed.includes('metadata'), routed);

    // -- Step 7: unknown domain rejection --
    console.log('\n7) Unknown-domain rejection');
    try {
        await axios.post(`${GATEWAY}/api/search`, { domain: 'ghost', query: 'anything' });
        assert('unknown domain returns 404', false, 'request unexpectedly succeeded');
    } catch (err) {
        assert('unknown domain returns 404', err.response && err.response.status === 404, err.response && err.response.status);
    }

    console.log(`\n== Result: ${failures === 0 ? 'ALL PASS' : `${failures} FAIL`} ==\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('\nSmoke crashed:', err.message);
    if (err.response) console.error('response:', err.response.status, err.response.data);
    process.exit(1);
});
