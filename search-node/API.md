# Search Node API

A **Search Node** owns one slice of the data and knows how to search it. The same Docker image runs three times with different `NODE_SPECIALTY` env values:

| Specialty | What it searches |
|-----------|------------------|
| `text` | Wordy fields listed under `schema.text` (e.g. `title`, `description`). Full-text contains-match. |
| `metadata` | Structured fields listed under `schema.metadata` (e.g. `price`, `level`). Supports operators (`<`, `>`, `=`, `:`) and comparison words (`under`, `over`). |
| `tags` | Label fields listed under `schema.tags` (e.g. `color`, `category`). Supports `#hashtag`, `field:value`, and plain word matches. |

Each search node fetches the schema for a domain from **Schema Registry** to know which fields belong to its slice.

**Default ports (Docker):**
- `search-node-1` (text): `http://search-node-1:3001`
- `search-node-2` (metadata): `http://search-node-2:3002`
- `search-node-3` (tags): `http://search-node-3:3003`

---

## GET /health

### What
Lightweight liveness check.

### Response — 200 OK
```json
{ "status": "ok", "service": "search-node", "specialty": "text", "nodeId": "node-text" }
```

---

## POST /index

### What
Stores documents under a domain. Each search node holds the **same documents**; the difference is which fields it actually searches.

### Why
The three nodes share one corpus; they each look at different parts. Sending the doc to all three keeps the data in sync. (A future Index Node layer may take over distribution.)

### How
```http
POST /index
Content-Type: application/json

{
  "domain": "ecommerce",
  "documents": [
    { "id": "d1", "title": "red shoes", "description": "sneakers", "price": 250, "brand": "nike", "color": ["red"], "category": ["shoes"] }
  ]
}
```

### Response — 200 OK
```json
{ "domain": "ecommerce", "indexed": 1, "ids": ["d1"], "specialty": "text", "nodeId": "node-text" }
```

### Errors
| Status | Cause |
|--------|-------|
| 400 | `domain` missing |
| 400 | `documents` not an array |

---

## POST /search

### What
Searches the stored documents in `domain` for `query` using **this node's specialty**. Returns matching documents scored by relevance.

### How
```http
POST /search
Content-Type: application/json

{
  "domain": "ecommerce",
  "query": "red shoes",
  "filters": {}
}
```

### Response — 200 OK
```json
{
  "domain": "ecommerce",
  "query": "red shoes",
  "specialty": "text",
  "nodeId": "node-text",
  "results": [
    { "id": "d1", "title": "red shoes", "score": 6 },
    { "id": "d3", "title": "running shoes", "score": 4 }
  ]
}
```

### Errors
| Status | Cause |
|--------|-------|
| 400 | `domain` or `query` missing |
| 404 | Domain not registered in Schema Registry |

---

## Scoring per specialty

### text (`textSearch`)
- Tokenizes the query (lowercase, splits on whitespace, drops stop words).
- For each doc, for each schema-`text` field, for each term that appears in the field: adds **3** if the field is title-like (`title`, `name`, `headline`), **1** otherwise.
- Sorts descending by total score.
- Whitespace-only query returns `[]`.

### metadata (`metadataSearch`)
- Parses **operator tokens** like `field<value`, `field=value`, `field>=value`, `field:value`.
- Parses **comparison-word patterns**: `field under N` → `field<N`, `field over N` → `field>N`, etc.
- Field names must exist in `schema.metadata` (unknown fields are dropped silently — Specialty Node has already validated them upstream).
- A doc matches only if **all** constraints hold (logical AND).
- Score = number of constraints satisfied. More specific queries score higher.
- Query with no recognizable constraint returns `[]`.

### tags (`tagsSearch`)
- Recognized token types:
  - `field:value` → exact match on `field` (weight 2).
  - `#word` → match any tag field containing `word` (weight 1.5).
  - Plain word → match any tag field containing the word (weight 1).
  - Stop words are skipped.
- A doc matches only if **all** tokens match (logical AND).
- Score = sum of weights for matched tokens.

---

## How a search node fits in the request flow

```
Gateway
  ├── (1) ask Specialty Node "which nodes for this query?"
  ├── (2) Gateway POSTs /search to each chosen search node, in parallel
  │       └── search node looks up schema for domain, runs its specialty's
  │           search function on the matching schema fields, returns results
  └── (3) Gateway merges results, weighting each by the node's confidence
```

Each search node is independent: it does not call other nodes. It only consults Schema Registry (read-only) to know which fields to look at.

---

## Architecture pieces

| File | Purpose |
|------|---------|
| `app.js` | Express wiring. Exports `createApp({ specialty, nodeId, schemaClient, docStore })` factory and a default singleton driven by env. |
| `docStore.js` | Domain-scoped in-memory document store. Optionally backed by a file (via the `FileStorage` from schema-registry). DB-agnostic — can be swapped later. |
| `textSearch.js` | Pure function: `textSearch(query, docs, fields) → results[]`. |
| `metadataSearch.js` | Pure function: `metadataSearch(query, docs, fields) → results[]`. |
| `tagsSearch.js` | Pure function: `tagsSearch(query, docs, fields) → results[]`. |
| `schemaClient.js` | Thin axios wrapper for `GET /schema/:domain` against Schema Registry. |

The search functions are deliberately **pure** (no I/O, no globals): you give them the docs and field list, they return scored results. This keeps them easy to test and easy to replace with real index data structures (B-tree, inverted index, bitmap, etc.) in Phase 2.

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_SPECIALTY` | `text` | One of `text`, `metadata`, `tags`. Determines which search function runs. |
| `NODE_ID` | `node-<specialty>` | Identifier returned in responses (useful for monitoring). |
| `PORT` | `3001` | HTTP port. |
| `SCHEMA_REGISTRY_URL` | `http://localhost:5000` | Where to fetch schemas. |
| `DATA_DIR` | `../data` | Where to persist the on-disk doc store (one file per node). |

---

## Limitations / known gaps

- **Search is contains-match, not index-based.** Every search scans every doc in the domain. Fine for prototyping; Phase 2 replaces this with inverted indexes (text), B-trees (metadata), and hash maps (tags).
- **Range patterns and bare digits are not handled by metadata search.** `100-500`, `between 100 and 500`, and a lone `500` will route to metadata via Specialty Node but match nothing here. Add when needed.
- **No deletes/updates.** `PUT id` replaces the doc, but there's no `/index DELETE` endpoint yet.
- **One DocStore per node.** No sharding within a node yet.

> **Status:** all three specialties implemented and integration-tested end-to-end. Next: replace contains-match with proper indexes (Phase 2), or layer Cache Node in front of Gateway.
