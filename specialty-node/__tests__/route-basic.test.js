const request = require('supertest');
const { app } = require('../app');
const { usePermissiveSchema } = require('../test-helpers/permissive-schema');

beforeAll(() => {
    usePermissiveSchema();
});

describe('POST /route', () => {
    test('returns 200 with echoed domain/query and a nodes array', async () => {
        const response = await request(app).post('/route').send({
            domain: 'ecommerce',
            query: 'red shoes'
        });

        expect(response.status).toBe(200);
        expect(response.body.domain).toBe('ecommerce');
        expect(response.body.query).toBe('red shoes');
        expect(Array.isArray(response.body.nodes)).toBe(true);
    });

    test('returns 400 when query is missing', async () => {
        const response = await request(app).post('/route').send({
            domain: 'ecommerce'
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/query/i);
    });

    test('returns 400 when domain is missing', async () => {
        const response = await request(app).post('/route').send({
            query: 'red shoes'
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/domain/i);
    });
});
