const fs = require('fs');
const path = require('path');

function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash >>> 0;
    }
    return hash;
}

class ShardStore {
    constructor({ shardCount = 4, baseDir } = {}) {
        if (!baseDir) throw new Error('baseDir is required');
        this.shardCount = shardCount;
        this.baseDir = baseDir;
        this.shards = Array.from({ length: shardCount }, () => new Map());
        this._dirtyShards = new Set();
    }

    shardFor(id) {
        return djb2(String(id)) % this.shardCount;
    }

    _bucket(shardIdx, domain) {
        const shard = this.shards[shardIdx];
        if (!shard.has(domain)) shard.set(domain, new Map());
        return shard.get(domain);
    }

    put(domain, doc) {
        if (!doc || !doc.id) throw new Error('doc.id is required');
        const idx = this.shardFor(doc.id);
        const bucket = this._bucket(idx, domain);
        bucket.set(doc.id, { ...doc });
        this._dirtyShards.add(idx);
        return doc.id;
    }

    flush() {
        for (const idx of this._dirtyShards) this._flushShard(idx);
        this._dirtyShards.clear();
    }

    batchGet(domain, ids) {
        const out = [];
        for (const id of ids) {
            const idx = this.shardFor(id);
            const bucket = this.shards[idx].get(domain);
            if (!bucket) continue;
            const doc = bucket.get(id);
            if (doc) out.push(doc);
        }
        return out;
    }

    _shardFile(idx) {
        return path.join(this.baseDir, `shard-${idx}.json`);
    }

    _flushShard(idx) {
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
        const shard = this.shards[idx];
        const out = {};
        for (const [domain, bucket] of shard.entries()) {
            out[domain] = Array.from(bucket.values());
        }
        fs.writeFileSync(this._shardFile(idx), JSON.stringify(out, null, 2), 'utf8');
    }

    load() {
        for (let idx = 0; idx < this.shardCount; idx++) {
            const file = this._shardFile(idx);
            if (!fs.existsSync(file)) continue;
            const blob = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
            const shard = this.shards[idx];
            shard.clear();
            for (const [domain, docs] of Object.entries(blob)) {
                const bucket = new Map();
                for (const doc of docs) bucket.set(doc.id, doc);
                shard.set(domain, bucket);
            }
        }
    }
}

module.exports = { ShardStore, djb2 };
