const fs = require('fs');
const os = require('os');
const path = require('path');
const { ShardStore } = require('../storage');

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'shard-store-'));
}

describe('ShardStore', () => {
    test('put + batchGet round-trips a doc by id', () => {
        const store = new ShardStore({ shardCount: 4, baseDir: tmpDir() });
        store.put('bookstore', { id: 'b1', title: 'Dune', price: 15 });

        const got = store.batchGet('bookstore', ['b1']);

        expect(got).toEqual([{ id: 'b1', title: 'Dune', price: 15 }]);
    });

    test('batchGet skips ids that do not exist', () => {
        const store = new ShardStore({ shardCount: 4, baseDir: tmpDir() });
        store.put('bookstore', { id: 'b1', title: 'Dune' });

        const got = store.batchGet('bookstore', ['b1', 'missing', 'b2']);

        expect(got).toEqual([{ id: 'b1', title: 'Dune' }]);
    });

    test('same id always lands in the same shard (deterministic hashing)', () => {
        const store = new ShardStore({ shardCount: 4, baseDir: tmpDir() });

        const a = store.shardFor('b1');
        const b = store.shardFor('b1');
        const c = store.shardFor('b1');

        expect(a).toBe(b);
        expect(b).toBe(c);
    });

    test('docs spread across multiple shards (not all in shard 0)', () => {
        const store = new ShardStore({ shardCount: 4, baseDir: tmpDir() });
        const ids = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];

        const used = new Set(ids.map(id => store.shardFor(id)));

        expect(used.size).toBeGreaterThan(1);
    });

    test('different domains are isolated (same id can exist in both)', () => {
        const store = new ShardStore({ shardCount: 4, baseDir: tmpDir() });
        store.put('bookstore', { id: 'x1', title: 'Dune' });
        store.put('recipes',   { id: 'x1', title: 'Pasta' });

        const fromBooks   = store.batchGet('bookstore', ['x1']);
        const fromRecipes = store.batchGet('recipes',   ['x1']);

        expect(fromBooks).toEqual([{ id: 'x1', title: 'Dune' }]);
        expect(fromRecipes).toEqual([{ id: 'x1', title: 'Pasta' }]);
    });

    test('load() restores docs from disk after explicit flush()', () => {
        const dir = tmpDir();
        const first = new ShardStore({ shardCount: 4, baseDir: dir });
        first.put('bookstore', { id: 'b1', title: 'Dune', price: 15 });
        first.put('bookstore', { id: 'b2', title: 'Foundation', price: 12 });
        first.flush();

        const second = new ShardStore({ shardCount: 4, baseDir: dir });
        second.load();

        const got = second.batchGet('bookstore', ['b1', 'b2']).sort((a, b) => a.id.localeCompare(b.id));
        expect(got).toEqual([
            { id: 'b1', title: 'Dune', price: 15 },
            { id: 'b2', title: 'Foundation', price: 12 },
        ]);
    });

    test('put does NOT write to disk — caller must call flush()', () => {
        const dir = tmpDir();
        const store = new ShardStore({ shardCount: 4, baseDir: dir });
        store.put('bookstore', { id: 'b1', title: 'Dune' });
        store.put('bookstore', { id: 'b2', title: 'Foundation' });
        const filesAfterPuts = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
        expect(filesAfterPuts).toEqual([]);
    });

    test('one flush after many puts writes each touched shard only once', () => {
        const dir = tmpDir();
        const store = new ShardStore({ shardCount: 4, baseDir: dir });
        for (let i = 0; i < 50; i++) {
            store.put('bookstore', { id: `b-${i}`, title: `T${i}` });
        }
        store.flush();
        const files = fs.readdirSync(dir).filter(f => f.startsWith('shard-')).sort();
        expect(files.length).toBeGreaterThan(0);
        expect(files.length).toBeLessThanOrEqual(4);
    });
});
