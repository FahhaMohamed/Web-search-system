const request = require('supertest');
const { app, registry } = require('../app');

describe('POST /schema/:domain', () => {
    beforeEach(() => {
        registry.schemas.clear();
    });

    test('registers a new schema for a domain and returns 201', async () => {
        const schema = {
            text: ['title', 'description'],
            metadata: ['price', 'brand', 'category'],
            tags: ['tags']
        };

        const response = await request(app)
            .post('/schema/ecommerce')
            .send(schema);

        expect(response.status).toBe(201);
        expect(response.body.domain).toBe('ecommerce');
        expect(response.body.schema).toEqual(schema);
    });

    test('saves the schema so it can be retrieved internally', async () => {
        const schema = {
            text: ['post'],
            metadata: ['author'],
            tags: ['hashtags']
        };

        await request(app)
            .post('/schema/social')
            .send(schema);

        expect(registry.schemas.get('social')).toEqual(schema);
    });
});
