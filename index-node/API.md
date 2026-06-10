# Index Node API

The **Index Node** is the front door of the **store path**. When someone wants to add new documents to the system, the Gateway forwards them here. The Index Node:

1. Checks the **Schema Registry** to confirm the domain is registered (and therefore the system knows which fields are text/metadata/tags for it).
2. Fans the documents out **in parallel** to all three Search Nodes (text, metadata, tags) so each can index its own slice.
3. Returns a per-node summary so the caller can see if any node failed.

The Index Node is **stateless** and **domain-agnostic**: it stores nothing locally, and contains zero `if (domain === 'ecommerce')`-style branches. The raw-document Shard Cluster is a future Phase 2 piece.

**Default port (Docker):** `http://index-node-1:4001`

---

## GET /health

### What
Lightweight liveness check.

### Response — 200 OK
```json
{ "status": "ok", "service": "index-node", "nodeId": "index-1" }
```

---

## POST /index

### What
Validate a batch of documents against the schema for `domain`, then fan them out to every Search Node.

### Why
Search Nodes are the source of truth for searchable copies of documents. The Index Node guarantees that **all three** Search Nodes get exactly the same documents so the search side stays consistent.

### How
```http
POST /index
Content-Type: application/json

{
  "domain": "ecommerce",
  "documents": [
    { "id": "d1", "title": "red shoes", "price": 250, "color": ["red"], "category": ["shoes"] }
  ]
}
```

### Response — 200 OK
```json
{
  "domain": "ecommerce",
  "received": 1,
  "nodeId": "index-1",
  "searchNodes": [
    { "node": "text",     "ok": true, "indexed": 1, "nodeId": "node-text" },
    { "node": "metadata", "ok": true, "indexed": 1, "nodeId": "node-metadata" },
    { "node": "tags",     "ok": true, "indexed": 1, "nodeId": "node-tags" }
  ]
}
```

If a Search Node fails, its entry has `ok: false` and an `error` string. The overall response is still **200 OK** because some nodes may have succeeded — the caller decides whether partial success is acceptable.

```json
{
  "searchNodes": [
    { "node": "text",     "ok": true,  "indexed": 1 },
    { "node": "metadata", "ok": false, "status": 500, "error": "connection refused" },
    { "node": "tags",     "ok": true,  "indexed": 1 }
  ]
}
```

### Errors
| Status | Cause |
|--------|-------|
| 400 | `domain` missing |
| 400 | `documents` not an array |
| 400 | `documents` array is empty |
| 404 | Domain not registered in Schema Registry |

---

## How the Index Node fits in the store flow

```
Client
  └── POST /api/index (Gateway)
        └── Gateway -> POST /index (Index Node)
              ├── Index Node -> GET /schema/:domain (Schema Registry)   ← rejects unknown domains
              └── Index Node -> POST /index to each Search Node in parallel
                    ├── search-node-1 (text)
                    ├── search-node-2 (metadata)
                    └── search-node-3 (tags)
```

The Gateway never talks to the Search Nodes directly on the store path — that responsibility lives in the Index Node so the fan-out logic stays in one place.

---

## Architecture pieces

| File | Purpose |
|------|---------|
| `app.js` | Express wiring. Exports `createApp({ nodeId, schemaClient, indexClient })` factory and a default singleton driven by env vars. |
| `schemaClient.js` | Thin axios wrapper for `GET /schema/:domain` against Schema Registry. Returns `null` on 404. |
| `indexClient.js` | Pure fan-out: `POST /index` to text/metadata/tags Search Nodes in parallel; reports per-node success or error. |

The factory pattern lets tests inject stub clients (no real HTTP needed), which is why the unit tests run in milliseconds.

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ID` | `index-1` | Identifier returned in responses (useful for monitoring). |
| `PORT` | `4001` | HTTP port. |
| `SCHEMA_REGISTRY_URL` | `http://localhost:5000` | Where to fetch schemas for domain validation. |
| `TEXT_NODE_URL` | `http://search-node-1:3001` | Text-specialty Search Node URL. |
| `METADATA_NODE_URL` | `http://search-node-2:3002` | Metadata-specialty Search Node URL. |
| `TAGS_NODE_URL` | `http://search-node-3:3003` | Tags-specialty Search Node URL. |

---

## Limitations / known gaps

- **No write-ahead log (WAL).** A crash mid-fan-out can leave some Search Nodes with the doc and others without. Phase 2 will add a WAL that is replayed on restart.
- **No raw-document Shard Cluster.** Today the Search Nodes own the only copy. If all three lose their data files, the doc is gone. Phase 2 will introduce a Shard Cluster (source of truth for raw docs) so Search Nodes can be rebuilt by replaying from there.
- **No deletes or updates yet.** `POST /index` only inserts/replaces by `id`. A `DELETE /index` endpoint is on the roadmap.
- **One Index Node only.** No sharding by document id yet — every Index Node would fan out to the same Search Nodes today. Multiple Index Nodes become meaningful once the Shard Cluster lands.

> **Status:** Index Node is the architecture-correct entry point for the store path. End-to-end tests prove that documents indexed via Gateway `/api/index` are then searchable via Gateway `/api/search` through the full pipeline.
