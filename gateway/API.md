# Gateway API

The Gateway is the **entry point** of the search engine. It accepts a search request from the client, asks the **Specialty Node** which specialty nodes to query, fans out to only those nodes, and merges their results using confidence as a weight.

**Base URL (in Docker):** `http://gateway:3000`
**Base URL (local dev):** `http://localhost:3000`

---

## GET /api/health

### What
Returns the health status of the Gateway service itself.

### Why
Lightweight liveness check. Used by Docker, load balancers, and monitoring tools to confirm the Gateway process is running. Does **not** check upstream nodes.

### How
```http
GET /api/health
```

### Response — 200 OK
```json
{
  "status": "ok",
  "service": "gateway"
}
```

---

## POST /api/search

### What
Runs a search end-to-end:
1. Asks **Specialty Node** which specialty nodes (text/metadata/tags) to hit, with what confidence.
2. (Optionally) drops nodes below `minConfidence`.
3. Calls each chosen node's `/search` endpoint in parallel.
4. Merges results using each node's confidence as a multiplier on the raw score.
5. Returns the top-ranked documents.

### Why
Before this version the Gateway always called all 3 specialty nodes, even if the query was just `#summer` (only tags matter). That wasted CPU and network. Now the Gateway is **routing-aware**: it only calls the nodes Specialty Node says are relevant, and a high-confidence node ranks higher in the merged result list.

### How
```http
POST /api/search
Content-Type: application/json

{
  "domain": "ecommerce",
  "query": "red shoes under 500",
  "filters": { },
  "limit": 20,
  "minConfidence": 0.0
}
```

**Body fields:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `domain` | string | yes | — | Registered domain (must exist in Schema Registry). |
| `query` | string | yes | — | Raw user search query. |
| `filters` | object | no | `{}` | Optional structured filters, forwarded as-is to each node. |
| `limit` | number | no | `20` | Max documents to return. |
| `minConfidence` | number | no | `0.0` | Drop any specialty node returned below this confidence (0.0–1.0). |

### Response — 200 OK
```json
{
  "query": "red shoes under 500",
  "domain": "ecommerce",
  "totalResults": 2,
  "results": [
    { "id": "doc-1", "score": 1.6, "sources": ["text", "metadata"], "title": "Red sneakers under $50" },
    { "id": "doc-9", "score": 0.7, "sources": ["text"], "title": "Crimson loafers" }
  ],
  "routing": [
    { "name": "metadata", "confidence": 0.9 },
    { "name": "text", "confidence": 0.7 }
  ],
  "searchNodes": [
    { "nodeName": "metadata", "confidence": 0.9, "resultCount": 5 },
    { "nodeName": "text", "confidence": 0.7, "resultCount": 7 }
  ],
  "timestamp": "2026-06-09T12:00:00.000Z"
}
```

**Response fields:**
| Field | Type | Description |
|-------|------|-------------|
| `query`, `domain` | string | Echoed back. |
| `totalResults` | number | Unique documents after merge (before `limit` slice). |
| `results` | object[] | Top-ranked docs, sorted by `score` descending. Each has weighted `score` and `sources` (which nodes contributed). |
| `routing` | object[] | Nodes picked by Specialty Node **after** `minConfidence` filter. |
| `searchNodes` | object[] | Per-node call summary (name, confidence, result count, error if any). |
| `timestamp` | string | ISO-8601 server time. |

### Errors

| Status | Cause | Body |
|--------|-------|------|
| 400 | `query` missing | `{ "error": "query is required" }` |
| 400 | `domain` missing | `{ "error": "domain is required" }` |
| 400 | Specialty Node rejected query (e.g. unknown field) | `{ "error": "Unknown field: xyz" }` |
| 404 | Domain not registered in Schema Registry | `{ "error": "Domain not found: <domain>" }` |
| 500 | Specialty Node unreachable | `{ "error": "<network error>" }` |

---

## Merge & Rank

Each specialty node returns documents with a raw `score`. The Gateway recomputes each document's final score as:

```
final_score = sum over contributing nodes of (raw_score * node_confidence)
```

So the same document found by `text@0.7` and `tags@0.4` gets `1.0*0.7 + 1.0*0.4 = 1.1`. A document found only by `tags@0.4` gets `0.4`. A confidence-1.0 node leaves the raw score unchanged.

After merging, results are sorted by `final_score` descending, then trimmed to `limit`.

### Why weighted merge
Without weighting, a noisy match from a low-confidence node could outrank a clean match from a high-confidence node — the user would see irrelevant results first. Weighting lets the Gateway trust the Specialty Node's routing decision quantitatively, not just as a yes/no.

---

## POST /api/index

### What
Distributes a batch of documents across the configured Index Nodes (round-robin chunking).

### How
```http
POST /api/index
Content-Type: application/json

{
  "domain": "ecommerce",
  "documents": [ { "id": "doc-1", ... }, { "id": "doc-2", ... } ]
}
```

### Response — 200 OK
```json
{
  "message": "Indexing completed",
  "domain": "ecommerce",
  "totalDocuments": 2,
  "totalIndexed": 2,
  "indexNodes": [
    { "nodeId": "index1", "indexed": 1, "success": true },
    { "nodeId": "index2", "indexed": 1, "success": true }
  ]
}
```

### Errors
| Status | Cause |
|--------|-------|
| 400 | `documents` missing or not an array |
| 500 | Internal error during chunking/fan-out |

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Port the Gateway listens on. |
| `SPECIALTY_NODE_URL` | `http://specialty-node:6000` | URL of the Specialty Node. |
| `TEXT_NODE_URL` | `http://search-node-1:3001` | URL of the Text specialty node. |
| `METADATA_NODE_URL` | `http://search-node-2:3002` | URL of the Metadata specialty node. |
| `TAGS_NODE_URL` | `http://search-node-3:3003` | URL of the Tags specialty node. |
| `INDEX_NODE_1_URL` | `http://index-node-1:4001` | First index node. |
| `INDEX_NODE_2_URL` | `http://index-node-2:4002` | Second index node. |

---

## Design notes

- **No more `splitQuery` in Gateway.** Query understanding lives in Specialty Node. Gateway just orchestrates: route → fan-out → merge.
- **Injectable clients.** `SpecialtyClient` and `SearchClient` are swappable for testing (`setSpecialtyClient`, `setSearchClient` exports), so tests never hit real HTTP.
- **No DB choice yet.** Each specialty node owns its own storage; Gateway stays storage-agnostic.

> **Status:** Specialty-aware routing, fan-out filtering, and confidence-weighted merge are implemented. Next: Cache Node in front of Gateway.
