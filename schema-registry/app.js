const express = require('express');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SCHEMA_FILE = path.join(DATA_DIR, 'schemas.json');

class SchemaRegistry {
    constructor() {
        this.schemas = new Map();
    }

    save() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        const obj = Object.fromEntries(this.schemas);
        fs.writeFileSync(SCHEMA_FILE, JSON.stringify(obj, null, 2), 'utf8');
    }

    load() {
        if (!fs.existsSync(SCHEMA_FILE)) {
            return;
        }
        const raw = fs.readFileSync(SCHEMA_FILE, 'utf8');
        const obj = JSON.parse(raw);
        this.schemas = new Map(Object.entries(obj));
    }
}

const app = express();
app.use(express.json());

const registry = new SchemaRegistry();
registry.load();

function validateSchema(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        return 'Schema must be a JSON object';
    }
    const sections = ['text', 'metadata', 'tags'];
    const presentSections = sections.filter(s => s in schema);
    if (presentSections.length === 0) {
        return 'Schema must include at least one of: text, metadata, tags';
    }
    for (const section of presentSections) {
        const value = schema[section];
        if (!Array.isArray(value)) {
            return `Section "${section}" must be an array`;
        }
        for (const field of value) {
            if (typeof field !== 'string') {
                return `Section "${section}" must contain only string field names`;
            }
            if (field.trim() === '') {
                return `Section "${section}" contains an empty field name`;
            }
        }
    }
    return null;
}

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'schema-registry' });
});

app.post('/schema/:domain', (req, res) => {
    const { domain } = req.params;
    const schema = req.body;
    const error = validateSchema(schema);
    if (error) {
        return res.status(400).json({ error });
    }
    registry.schemas.set(domain, schema);
    registry.save();
    res.status(201).json({ domain, schema });
});

app.get('/schemas', (req, res) => {
    const domains = Array.from(registry.schemas.keys());
    res.json({ count: domains.length, domains });
});

app.get('/schema/:domain', (req, res) => {
    const { domain } = req.params;
    if (!registry.schemas.has(domain)) {
        return res.status(404).json({ error: `Schema not found for domain: ${domain}` });
    }
    const schema = registry.schemas.get(domain);
    res.json({ domain, schema });
});

app.put('/schema/:domain', (req, res) => {
    const { domain } = req.params;
    if (!registry.schemas.has(domain)) {
        return res.status(404).json({ error: `Schema not found for domain: ${domain}` });
    }
    const schema = req.body;
    const error = validateSchema(schema);
    if (error) {
        return res.status(400).json({ error });
    }
    registry.schemas.set(domain, schema);
    registry.save();
    res.json({ domain, schema });
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Schema Registry listening on port ${PORT}`);
    });
}

module.exports = { app, SchemaRegistry, registry };
