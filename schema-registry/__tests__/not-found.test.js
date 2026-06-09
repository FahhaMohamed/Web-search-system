const request = require('supertest');
const { app, registry } = require('../app');

describe('GET /schema/:domain — unknown domain', () => {
    beforeEach(() => {
        registry.schemas.clear();
    });

    test('returns 404 when domain is not registered', async () => {
        const response = await request(app).get('/schema/doesnotexist');

        expect(response.status).toBe(404);
        expect(response.body.error).toMatch(/not found/i);
        expect(response.body.error).toMatch(/doesnotexist/);
    });
});
