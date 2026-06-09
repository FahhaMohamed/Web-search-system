const request = require('supertest');
const { app } = require('../app');

describe('Gateway — sanity', () => {
    test('GET /api/health returns 200', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
    });
});
