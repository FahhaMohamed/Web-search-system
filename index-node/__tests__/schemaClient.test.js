const express = require('express');
const { SchemaClient } = require('../schemaClient');

const servers = [];
function listenFake(handler) {
    const app = express();
    app.get('/schema/:domain', handler);
    return new Promise(resolve => {
        const srv = app.listen(0, () => {
            servers.push(srv);
            resolve(`http://localhost:${srv.address().port}`);
        });
    });
}

afterAll(() => { for (const s of servers) s.close(); });

describe('SchemaClient.fetch', () => {
    test('returns the schema object on 200', async () => {
        const url = await listenFake((req, res) => {
            res.json({ domain: req.params.domain, schema: { text: ['title'], metadata: ['price'], tags: ['color'] } });
        });
        const client = new SchemaClient(url);
        const schema = await client.fetch('ecommerce');
        expect(schema).toEqual({ text: ['title'], metadata: ['price'], tags: ['color'] });
    });

    test('returns null when registry replies 404', async () => {
        const url = await listenFake((req, res) => res.status(404).json({ error: 'not found' }));
        const client = new SchemaClient(url);
        const schema = await client.fetch('ghost');
        expect(schema).toBeNull();
    });
});
