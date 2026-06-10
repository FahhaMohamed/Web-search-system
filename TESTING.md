# Manual Testing Guide

End-to-end manual testing for the distributed search engine, running on Docker.

This guide walks through the **full pipeline** — both the **store path** (adding docs) and the **search path** (querying) — using `curl` against the live containers. It is the human equivalent of `scripts/smoke.js`.

---

## 1. Architecture refresher

### Store flow — when you add docs

```
Client (curl)
   │
   │  POST /api/index { domain, documents }
   ▼
Gateway (3000)
   │
   │  POST /index { domain, documents }
   ▼
Index Node (4001)
   │
   ├──► Schema Registry (5000): GET /schema/:domain  ──► reject if domain unknown
   │
   │  fan out same docs to all 3 in parallel:
   ├──► Text Node (3001)     POST /index
   ├──► Metadata Node (3002) POST /index
   └──► Tags Node (3003)     POST /index
```

Each search node holds the same docs; the difference is which fields each one actually searches.

### Search flow — when you query

```
Client (curl)
   │
   │  POST /api/search { domain, query }
   ▼
Gateway (3000)
   │
   ├──► Specialty Node (6000): POST /route { domain, query }
   │    └── decides which nodes to ask (with confidence 0.0–1.0 each)
   │
   │  Gateway then queries ONLY the nodes Specialty named, in parallel:
   ├──► Text Node     POST /search
   ├──► Metadata Node POST /search
   └──► Tags Node     POST /search
   │
   ▼
Gateway merges results (each doc's score weighted by the node's confidence)
   │
   ▼
Sorted result list returned to client
```

---

## 2. Pre-flight checks

### 2.1 Bring the stack up (if not already running)

```bash
docker compose up -d
```

### 2.2 Confirm all 8 containers are running

```bash
docker ps
```

Expected — 8 containers, all `Up`:

| Name | Port | Purpose |
|---|---|---|
| `gateway` | 3000 | Single entry point for clients |
| `schema-registry` | 5000 | Owns the schemas per domain |
| `specialty-node` | 6000 | Decides which nodes to route to |
| `text-node` | 3001 | Full-text search (text fields) |
| `metadata-node` | 3002 | Operator + natural-language metadata search |
| `tags-node` | 3003 | Tag/hashtag/`field:value` matching |
| `index-node` | 4001 | Store-path fan-out |
| `monitoring` | 8080 | (Optional UI) |

### 2.3 Health probes

```bash
curl http://localhost:3000/api/health      # gateway
curl http://localhost:5000/health          # schema-registry
curl http://localhost:6000/health          # specialty-node
curl http://localhost:4001/health          # index-node
curl http://localhost:3001/health          # text-node
curl http://localhost:3002/health          # metadata-node
curl http://localhost:3003/health          # tags-node
```

Each should return `{ "status": "ok", ... }`.

---

## 3. Register a schema

The system is **domain-agnostic** — you decide what your fields mean by registering a schema.

### Request

```bash
curl -X POST http://localhost:5000/schema/bookstore \
  -H "Content-Type: application/json" \
  -d '{"text":["title","summary"],"metadata":["price","year","rating"],"tags":["genre","author"]}'
```

### Expected response

```json
{
  "domain": "bookstore",
  "schema": {
    "text": ["title", "summary"],
    "metadata": ["price", "year", "rating"],
    "tags": ["genre", "author"]
  }
}
```

### Verify

```bash
curl http://localhost:5000/schema/bookstore
```

Same body comes back. Schema persisted under `data/schemas.json`.

---

## 4. Store path — index 5 books

```bash
curl -X POST http://localhost:3000/api/index \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "bookstore",
    "documents": [
      {"id":"b1","title":"The Pragmatic Programmer","summary":"craft of software","price":30,"year":1999,"rating":5,"genre":["tech"],"author":["hunt"]},
      {"id":"b2","title":"Clean Code","summary":"writing clean software","price":35,"year":2008,"rating":5,"genre":["tech"],"author":["martin"]},
      {"id":"b3","title":"Dune","summary":"desert planet adventure","price":15,"year":1965,"rating":4,"genre":["scifi"],"author":["herbert"]},
      {"id":"b4","title":"Foundation","summary":"galactic empire collapse","price":12,"year":1951,"rating":5,"genre":["scifi"],"author":["asimov"]},
      {"id":"b5","title":"Cheap Pulp Reads","summary":"quick stories","price":3,"year":2020,"rating":2,"genre":["fiction"],"author":["various"]}
    ]
  }'
```

### Expected response

```json
{
  "domain": "bookstore",
  "received": 5,
  "nodeId": "index-node",
  "searchNodes": [
    {"node":"text","ok":true,"indexed":5,"nodeId":"text-node"},
    {"node":"metadata","ok":true,"indexed":5,"nodeId":"metadata-node"},
    {"node":"tags","ok":true,"indexed":5,"nodeId":"tags-node"}
  ]
}
```

**What this proves:** Gateway → Index Node → all 3 Search Nodes received the docs. Store flow complete.

---

## 5. Search path — try each specialty

### 5.1 Pure text — plain words

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"domain":"bookstore","query":"clean software"}'
```

**Expected:** `b2` (Clean Code) wins, because both words appear in title + summary.
**Routing:** `text` only.

### 5.2 Pure metadata — operator syntax

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"domain":"bookstore","query":"price<20"}'
```

**Expected:** `b3` (15), `b4` (12), `b5` (3).
**Routing:** `metadata` only.

### 5.3 Pure metadata — natural language

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"domain":"bookstore","query":"price under 20"}'
```

**Expected:** Same as 5.2 — `b3`, `b4`, `b5`.
**Why:** Metadata search recognizes `field under N` → `field<N`. Same for `over`, `above`, `below`, `less`, `more`.

### 5.4 Pure tags — `field:value`

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"domain":"bookstore","query":"genre:scifi"}'
```

**Expected:** `b3` (Dune) + `b4` (Foundation).
**Routing:** `tags` only.

### 5.5 Pure tags — hashtag

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"domain":"bookstore","query":"#tech"}'
```

**Expected:** `b1` + `b2`.
**Routing:** `tags` only.

### 5.6 Compound query — hits multiple nodes

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"domain":"bookstore","query":"galactic price under 20 genre:scifi"}'
```

**Expected top result:** `b4` (Foundation — matches "galactic" in summary, `price<20`, and `genre:scifi`).
**Routing:** all 3 nodes — `text`, `metadata`, `tags`.
**Why:** Specialty Node tokenises the query, consults the schema, decides each token's specialty, and tells Gateway to fan out only to nodes that have something to do.

### 5.7 minConfidence filter — drop weak nodes

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"domain":"bookstore","query":"clean software","minConfidence":0.6}'
```

**Expected:** Same `b2` result, but `routing` array only contains nodes whose confidence ≥ 0.6.
**Why:** Tunes precision-vs-recall per query without changing server config.

---

## 6. Error paths

### 6.1 Unknown domain — search

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"domain":"ghost","query":"anything"}'
```

**Expected:** HTTP 404, `{"error":"Domain not found: ghost"}`.

### 6.2 Unknown domain — store

```bash
curl -X POST http://localhost:3000/api/index \
  -H "Content-Type: application/json" \
  -d '{"domain":"ghost","documents":[{"id":"x","title":"y"}]}'
```

**Expected:** HTTP 404, `{"error":"Domain not registered: ghost"}`.

### 6.3 Missing required field

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"domain":"bookstore"}'
```

**Expected:** HTTP 400, `{"error":"query is required"}`.

---

## 7. Try your own domain (challenge)

The system is domain-agnostic — try anything. Examples:

| Domain | text fields | metadata fields | tags fields |
|---|---|---|---|
| `cars` | model, description | price, year, mileage | brand, fuel |
| `recipes` | title, instructions | calories, prepTime | cuisine, diet |
| `movies` | title, plot | rating, year, runtime | genre, director |
| `jobs` | title, description | salary, postedAgo | location, level |

Repeat sections 3 → 4 → 5 with your fields. The system has zero `if (domain === 'whatever')` branches anywhere — every domain is equal.

---

## 8. Peek into containers while testing

```bash
docker logs gateway        # see routing decisions + fan-out timing
docker logs specialty-node # see which nodes were chosen and why
docker logs index-node     # see store-path fan-out
docker logs text-node      # see /index + /search calls the text node received
docker logs metadata-node  # same for metadata
docker logs tags-node      # same for tags
docker logs schema-registry
```

---

## 9. Known design notes

### 9.1 Each Search Node stores the full document

When you inspect `data/*.json`, you will notice **every search node holds the whole doc**, not just its slice of fields. Metadata Node's file has `title` and `summary` even though it never searches them.

**This is intentional, not a bug.** Each search node currently doubles as storage. In **Phase 2**, a separate **Shard Cluster** will own the raw documents (the single source of truth), and each search node will keep only the data structure it actually needs (inverted index for text, B-tree for metadata, hash map for tags). Until then: results stay correct, storage stays simple, and the swap-point is clearly defined.

### 9.2 Database integration is deferred

All persistence today is **in-memory `Map` + JSON file** behind a `FileStorage` interface. A real database (Postgres, RocksDB, etc.) will be slotted in after **Phase 2 algorithm work** completes (BM25 for text, Jaccard for tags, proper inverted indexes).

### 9.3 Search is contains-match (Phase 2 will fix)

Every search currently scans every doc in the domain. Fine for a few hundred docs; not for production scale. Phase 2 replaces this with proper index data structures.

---

## 10. Shutting down

```bash
docker compose down              # stop and remove containers (data volume kept)
docker compose down -v           # also wipe the ./data volume
```

---

## Tips for Windows users

- **Git Bash:** the `curl ... -d '...'` syntax above works as-is.
- **PowerShell / cmd:** replace outer single quotes with double quotes and escape inner quotes with `\"`, **or** save the body to a `.json` file and use `-d @body.json`. Example:

```powershell
@'
{"domain":"bookstore","query":"clean software"}
'@ | Out-File body.json -Encoding utf8
curl -X POST http://localhost:3000/api/search -H "Content-Type: application/json" -d "@body.json"
```
