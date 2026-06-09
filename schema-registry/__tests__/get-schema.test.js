const request = require('supertest');
const { app, registry } = require('../app');

describe('GET /schema/:domain', () => {
    beforeEach(() => {
        registry.schemas.clear();
    });

    test('returns the saved schema for a registered domain', async () => {
        const schema = {
            text: ['title', 'description'],
            metadata: ['price', 'brand'],
            tags: ['tags']
        };

        await request(app).post('/schema/ecommerce').send(schema);

        const response = await request(app).get('/schema/ecommerce');

        expect(response.status).toBe(200);
        expect(response.body.domain).toBe('ecommerce');
        expect(response.body.schema).toEqual(schema);
    });
});
