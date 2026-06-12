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
   ├──► Shard Cluster (7000): PUT /docs { domain, documents }
   │    └── stores raw docs as source of truth; placed by hash(id) % shardCount
   │        (if shard write fails, fan-out is skipped and 502 is returned)
   │
   │  fan out same docs to all 3 in parallel:
   ├──► Text Node (3001)     POST /index
   ├──► Metadata Node (3002) POST /index
   └──► Tags Node (3003)     POST /index
```

Shard Cluster holds the **full raw doc** as the single source of truth. Each search node also stores the docs today (Phase 1 simplification), but its job is the index — not the canonical record.

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
   ├──► Text Node     POST /search    →  returns [{id, score}, ...]   (no full doc)
   ├──► Metadata Node POST /search    →  returns [{id, score}, ...]
   └──► Tags Node     POST /search    →  returns [{id, score}, ...]
   │
   ▼
Gateway merges results (each doc's score weighted by the node's confidence)
   │
   ├──► Shard Cluster (7000): POST /docs/batch-get { domain, ids: top-K }
   │    └── late hydrate — fetch full docs for the final top-K ids only
   │
   ▼
Sorted result list with full doc fields returned to client
```

**Why two hops to Shard Cluster?** Search Nodes return only `id` + `score` — small payloads even across many nodes. Merge & Rank then makes ONE batch call to Shard Cluster to hydrate the final top-K full docs. Tiny network cost, single source of truth.

---

## 2. Pre-flight checks

### 2.1 Bring the stack up (if not already running)

```bash
docker compose up -d
```

### 2.2 Confirm all 9 containers are running

```bash
docker ps
```

Expected — 9 containers, all `Up`:

| Name | Port | Purpose |
|---|---|---|
| `gateway` | 3000 | Single entry point for clients |
| `schema-registry` | 5000 | Owns the schemas per domain |
| `specialty-node` | 6000 | Decides which nodes to route to |
| `text-node` | 3001 | Full-text search (text fields) |
| `metadata-node` | 3002 | Operator + natural-language metadata search |
| `tags-node` | 3003 | Tag/hashtag/`field:value` matching |
| `index-node` | 4001 | Store-path fan-out |
| `shard-cluster` | 7000 | Raw-doc source of truth (sharded by `hash(id)`); hydrates top-K on search |
| `monitoring` | 8080 | (Optional UI) |

### 2.3 Health probes

```bash
curl http://localhost:3000/api/health      # gateway
curl http://localhost:5000/health          # schema-registry
curl http://localhost:6000/health          # specialty-node
curl http://localhost:4001/health          # index-node
curl http://localhost:7000/health          # shard-cluster
curl http://localhost:3001/health          # text-node
curl http://localhost:3002/health          # metadata-node
curl http://localhost:3003/health          # tags-node
```

Each should return `{ "status": "ok", ... }`. Shard Cluster also reports `shardCount`.

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
  "shardCluster": { "ok": true, "stored": 5, "ids": ["b1","b2","b3","b4","b5"] },
  "searchNodes": [
    {"node":"text","ok":true,"indexed":5,"nodeId":"text-node"},
    {"node":"metadata","ok":true,"indexed":5,"nodeId":"metadata-node"},
    {"node":"tags","ok":true,"indexed":5,"nodeId":"tags-node"}
  ]
}
```

**What this proves:** Gateway → Index Node → Shard Cluster (raw doc store) → all 3 Search Nodes. The `shardCluster` block confirms the source-of-truth write succeeded. If Shard Cluster were down, you'd get `502` and the search nodes would NOT be touched.

### Verify Shard Cluster directly

```bash
curl -X POST http://localhost:7000/docs/batch-get \
  -H "Content-Type: application/json" \
  -d '{"domain":"bookstore","ids":["b1","b4"]}'
```

Returns the full raw docs by id — proves Shard Cluster holds the source of truth.

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

**Hydrated response shape (new):** Each result now contains the full doc fields, hydrated by Gateway from Shard Cluster:

```json
{
  "results": [
    {
      "id": "b2",
      "title": "Clean Code",
      "summary": "writing clean software",
      "price": 35,
      "year": 2008,
      "rating": 5,
      "genre": ["tech"],
      "author": ["martin"],
      "score": 12,
      "sources": ["text"]
    }
  ],
  "routing": [ { "name": "text", "confidence": 0.9 } ]
}
```

Search Nodes themselves only return `{id, score}`. The full fields come from Shard Cluster after the merge.

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

## 7. Try a second domain (movies) — prove domain-agnostic

The system has zero `if (domain === 'whatever')` branches. To prove it, register a totally different domain and repeat the flow.

### 7.1 Register the movies schema

```bash
curl -X POST http://localhost:5000/schema/movies \
  -H "Content-Type: application/json" \
  -d '{"text":["title","plot"],"metadata":["rating","year","runtime"],"tags":["genre","director"]}'
```

### 7.2 Index 3 movies

```bash
curl -X POST http://localhost:3000/api/index \
  -H "Content-Type: application/json" \
  -d '{
    "domain":"movies",
    "documents":[
      {"id":"m1","title":"Inception","plot":"dreams within dreams","rating":8.8,"year":2010,"runtime":148,"genre":["scifi"],"director":["nolan"]},
      {"id":"m2","title":"The Godfather","plot":"mafia family saga","rating":9.2,"year":1972,"runtime":175,"genre":["crime"],"director":["coppola"]},
      {"id":"m3","title":"Interstellar","plot":"space and time travel","rating":8.6,"year":2014,"runtime":169,"genre":["scifi"],"director":["nolan"]}
    ]
  }'
```

**Expected:** `shardCluster.stored: 3`, all 3 search nodes ack.

### 7.3 Text query — "dreams"

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"domain":"movies","query":"dreams"}'
```

**Expected top:** `m1` (Inception). Result is hydrated — you should see `title: "Inception"`, `year: 2010`, etc.

### 7.4 Metadata query — `year>2000`

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"domain":"movies","query":"year>2000"}'
```

**Expected:** `m1` + `m3`. Routing: `metadata` only.

### 7.5 Tags query — `director:nolan`

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"domain":"movies","query":"director:nolan"}'
```

**Expected:** `m1` + `m3`. Routing: `tags` only.

### 7.6 Compound — space sci-fi after 2010

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"domain":"movies","query":"space genre:scifi year over 2010"}'
```

**Expected top:** `m3` (Interstellar). Routing: all 3 nodes. Result is hydrated with `title`, `plot`, `year`, etc.

### 7.7 Other domains to try

| Domain | text fields | metadata fields | tags fields |
|---|---|---|---|
| `cars` | model, description | price, year, mileage | brand, fuel |
| `jobs` | title, description | salary, postedAgo | location, level |
| `recipes` | title, instructions | calories, prepTime | cuisine, diet |

Repeat 7.1 → 7.6 with your fields. Every domain is treated the same.

---

## 8. Inspect on-disk state

After indexing, the data directory looks like this:

```
data/
├── schemas.json                  # Schema Registry: all registered domains
├── search-text-node.json         # Text Node's local copy of docs (Phase 1)
├── search-metadata-node.json     # Metadata Node's local copy of docs (Phase 1)
├── search-tags-node.json         # Tags Node's local copy of docs (Phase 1)
└── shards/
    ├── shard-0.json              # Shard Cluster shard 0 (raw docs, by hash(id) % 4)
    ├── shard-1.json
    ├── shard-2.json
    └── shard-3.json
```

`data/shards/shard-*.json` is the **source of truth**. Docs are spread by `hash(doc_id) % shardCount`. Open any shard file to see the raw JSON docs.

```bash
# show how docs are distributed across shards
for f in data/shards/shard-*.json; do
  echo "=== $f ==="
  cat "$f"
done
```

---

## 9. Peek into containers while testing

```bash
docker logs gateway        # routing decisions, fan-out timing, Shard Cluster hydrate calls
docker logs specialty-node # which nodes were chosen and why
docker logs index-node     # store-path fan-out + Shard Cluster write
docker logs shard-cluster  # PUT /docs + POST /docs/batch-get
docker logs text-node      # /index + /search calls the text node received
docker logs metadata-node
docker logs tags-node
docker logs schema-registry
```

---

## 10. Known design notes

### 10.1 Shard Cluster is the source of truth (NEW in this milestone)

Raw docs now live in `data/shards/shard-*.json`. Search Nodes return only `{id, score}`; Gateway hydrates the final top-K from Shard Cluster. This separates **what is searched** (search nodes' indexes) from **what is stored** (raw docs).

### 10.2 Each Search Node still keeps its own copy of docs (Phase 1 carry-over)

Search Nodes still receive full docs from Index Node and persist them locally — they just don't return them in `/search`. In **Phase 2**, each search node will keep only its slice (inverted index for text, B-tree for metadata, hash map for tags), and the raw-doc copies in `data/search-*-node.json` will go away.

### 10.3 Database integration is deferred

All persistence today is **in-memory `Map` + JSON file**. A real database (Postgres, RocksDB, etc.) will be slotted in after **Phase 2 algorithm work** completes (BM25 for text, Jaccard for tags, proper inverted indexes).

### 10.4 Search is contains-match (Phase 2 will fix)

Every search currently scans every doc in the domain. Fine for a few hundred docs; not for production scale. Phase 2 replaces this with proper index data structures.

---

## 11. Shutting down

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
