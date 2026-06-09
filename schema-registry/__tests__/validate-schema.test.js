const request = require('supertest');
const { app, registry } = require('../app');

describe('Schema validation on POST /schema/:domain', () => {
    beforeEach(() => {
        registry.schemas.clear();
    });

    test('rejects empty object with 400', async () => {
        const response = await request(app).post('/schema/bad').send({});
        expect(response.status).toBe(400);
        expect(response.body.error).toBeDefined();
    });

    test('rejects when text is not an array', async () => {
        const response = await request(app).post('/schema/bad').send({
            text: 'not-an-array'
        });
        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/array/i);
    });

    test('rejects when metadata array contains non-string item', async () => {
        const response = await request(app).post('/schema/bad').send({
            metadata: ['price', 123]
        });
        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/string/i);
    });

    test('rejects when tags array contains empty string', async () => {
        const response = await request(app).post('/schema/bad').send({
            tags: ['valid', '']
        });
        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/empty/i);
    });

    test('accepts schema with only one section (e.g. just text)', async () => {
        const response = await request(app).post('/schema/textonly').send({
            text: ['title']
        });
        expect(response.status).toBe(201);
    });
});

describe('Schema validation on PUT /schema/:domain', () => {
    beforeEach(() => {
        registry.schemas.clear();
    });

    test('rejects invalid update with 400', async () => {
        await request(app).post('/schema/ecommerce').send({
            text: ['title'], metadata: ['price'], tags: ['tags']
        });

        const response = await request(app).put('/schema/ecommerce').send({
            text: 'not-an-array'
        });
        expect(response.status).toBe(400);
    });
});
