const request = require('supertest');
const { app } = require('../app');

describe('GET /health', () => {
    test('returns 200 with service name', async () => {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
        expect(response.body.status).toBe('ok');
        expect(response.body.service).toBe('specialty-node');
    });
});
