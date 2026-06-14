const { DocStore } = require('../docStore');

describe('DocStore — in-memory document storage', () => {
    test('put assigns a generated id when doc has none', () => {
        const store = new DocStore();
        const id = store.put('ecommerce', { title: 'red shoes' });
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
    });

    test('put preserves the id when the doc already has one', () => {
        const store = new DocStore();
        const id = store.put('ecommerce', { id: 'doc-42', title: 'blue shoes' });
        expect(id).toBe('doc-42');
    });

    test('get returns the document by id within the same domain', () => {
        const store = new DocStore();
        store.put('ecommerce', { id: 'doc-1', title: 'red shoes' });
        const doc = store.get('ecommerce', 'doc-1');
        expect(doc).toEqual({ id: 'doc-1', title: 'red shoes' });
    });

    test('get returns null for missing domain', () => {
        const store = new DocStore();
        expect(store.get('nope', 'doc-1')).toBeNull();
    });

    test('get returns null for missing id', () => {
        const store = new DocStore();
        store.put('ecommerce', { id: 'doc-1', title: 'red shoes' });
        expect(store.get('ecommerce', 'doc-999')).toBeNull();
    });

    test('list returns all docs in a domain in insertion order', () => {
        const store = new DocStore();
        store.put('ecommerce', { id: 'a', title: 'A' });
        store.put('ecommerce', { id: 'b', title: 'B' });
        store.put('logs', { id: 'c', title: 'C' });
        expect(store.list('ecommerce').map(d => d.id)).toEqual(['a', 'b']);
    });

    test('list returns empty array for unknown domain', () => {
        const store = new DocStore();
        expect(store.list('nope')).toEqual([]);
    });

    test('domains() lists all domains that have at least one doc', () => {
        const store = new DocStore();
        store.put('ecommerce', { id: 'a' });
        store.put('logs', { id: 'b' });
        expect(store.domains().sort()).toEqual(['ecommerce', 'logs']);
    });

    test('put on existing id replaces the doc', () => {
        const store = new DocStore();
        store.put('ecommerce', { id: 'doc-1', title: 'old' });
        store.put('ecommerce', { id: 'doc-1', title: 'new' });
        expect(store.get('ecommerce', 'doc-1').title).toBe('new');
        expect(store.list('ecommerce')).toHaveLength(1);
    });
});

describe('DocStore — persistence (file-backed)', () => {
    function makeFakePersistence() {
        let blob = null;
        return {
            read: () => blob || {},
            write: (obj) => { blob = JSON.parse(JSON.stringify(obj)); },
            inspect: () => blob,
        };
    }

    test('flush writes current state via persistence', () => {
        const persistence = makeFakePersistence();
        const store = new DocStore(persistence);
        store.put('ecommerce', { id: 'a', title: 'A' });
        store.flush();
        expect(persistence.inspect()).toEqual({
            ecommerce: [{ id: 'a', title: 'A' }],
        });
    });

    test('load restores state from persistence', () => {
        const persistence = makeFakePersistence();
        persistence.write({ ecommerce: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] });
        const store = new DocStore(persistence);
        store.load();
        expect(store.list('ecommerce').map(d => d.id)).toEqual(['a', 'b']);
    });

    test('put does NOT auto-flush — caller must call flush() explicitly', () => {
        const persistence = makeFakePersistence();
        const store = new DocStore(persistence);
        store.put('ecommerce', { id: 'a' });
        store.put('ecommerce', { id: 'b' });
        expect(persistence.inspect()).toBeNull();
    });

    test('one flush after many puts writes only once (avoids O(n^2) writes)', () => {
        let writeCount = 0;
        const persistence = {
            read: () => ({}),
            write: () => { writeCount += 1; },
        };
        const store = new DocStore(persistence);
        for (let i = 0; i < 50; i++) store.put('ecommerce', { id: `d-${i}` });
        store.flush();
        expect(writeCount).toBe(1);
    });
});
