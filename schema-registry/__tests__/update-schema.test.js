const request = require('supertest');
const { app, registry } = require('../app');

describe('PUT /schema/:domain', () => {
    beforeEach(() => {
        registry.schemas.clear();
    });

    test('updates an existing schema and returns 200', async () => {
        await request(app).post('/schema/ecommerce').send({
            text: ['title'], metadata: ['price'], tags: ['tags']
        });

        const updated = {
            text: ['title', 'description'],
            metadata: ['price', 'discount_price'],
            tags: ['tags']
        };

        const response = await request(app).put('/schema/ecommerce').send(updated);

        expect(response.status).toBe(200);
        expect(response.body.domain).toBe('ecommerce');
        expect(response.body.schema).toEqual(updated);

        const getResponse = await request(app).get('/schema/ecommerce');
        expect(getResponse.body.schema).toEqual(updated);
    });

    test('returns 404 when updating a domain that does not exist', async () => {
        const response = await request(app).put('/schema/nonexistent').send({
            text: ['x'], metadata: ['y'], tags: ['z']
        });

        expect(response.status).toBe(404);
        expect(response.body.error).toMatch(/not found/i);
    });
});
