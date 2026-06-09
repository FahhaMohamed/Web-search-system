const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { app, registry, SchemaRegistry } = require('../app');

const TEST_DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SCHEMA_FILE = path.join(TEST_DATA_DIR, 'schemas.json');

describe('Schema persistence', () => {
    beforeEach(() => {
        registry.schemas.clear();
        if (fs.existsSync(SCHEMA_FILE)) {
            fs.unlinkSync(SCHEMA_FILE);
        }
    });

    afterAll(() => {
        if (fs.existsSync(SCHEMA_FILE)) {
            fs.unlinkSync(SCHEMA_FILE);
        }
    });

    test('saves schemas to disk after POST', async () => {
        await request(app).post('/schema/ecommerce').send({
            text: ['title'], metadata: ['price'], tags: ['tags']
        });

        expect(fs.existsSync(SCHEMA_FILE)).toBe(true);
        const saved = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
        expect(saved.ecommerce).toEqual({
            text: ['title'], metadata: ['price'], tags: ['tags']
        });
    });

    test('loads schemas from disk on new instance (simulating restart)', async () => {
        await request(app).post('/schema/ecommerce').send({
            text: ['title'], metadata: ['price'], tags: ['tags']
        });

        const freshRegistry = new SchemaRegistry();
        freshRegistry.load();

        expect(freshRegistry.schemas.get('ecommerce')).toEqual({
            text: ['title'], metadata: ['price'], tags: ['tags']
        });
    });

    test('saves schemas to disk after PUT', async () => {
        await request(app).post('/schema/ecommerce').send({
            text: ['title'], metadata: ['price'], tags: ['tags']
        });

        await request(app).put('/schema/ecommerce').send({
            text: ['title', 'description'], metadata: ['price'], tags: ['tags']
        });

        const saved = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
        expect(saved.ecommerce.text).toEqual(['title', 'description']);
    });
});
