const request = require('supertest');
const { app, registry } = require('../app');

describe('GET /schemas', () => {
    beforeEach(() => {
        registry.schemas.clear();
    });

    test('returns empty list when no domains are registered', async () => {
        const response = await request(app).get('/schemas');

        expect(response.status).toBe(200);
        expect(response.body.count).toBe(0);
        expect(response.body.domains).toEqual([]);
    });

    test('returns all registered domains', async () => {
        await request(app).post('/schema/ecommerce').send({
            text: ['title'], metadata: ['price'], tags: ['tags']
        });
        await request(app).post('/schema/social').send({
            text: ['post'], metadata: ['author'], tags: ['hashtags']
        });

        const response = await request(app).get('/schemas');

        expect(response.status).toBe(200);
        expect(response.body.count).toBe(2);
        expect(response.body.domains).toEqual(expect.arrayContaining(['ecommerce', 'social']));
    });
});
