# Distributed Search Engine — Polished Architecture (v2)

> Research project: a domain-agnostic distributed search engine that any project can install as an SDK/library.
> This document **keeps the original architecture** and **adds new helper nodes** to fix known gaps in existing systems.

---

## 1. Research Goal

Build a distributed search engine that fixes these gaps in existing engines (Elasticsearch, OpenSearch, Meilisearch, etc.):

| # | Gap in Existing Engines | Our Fix |
|---|---|---|
| 1 | One-size-fits-all design (same engine for every domain) | Domain Adapters + Specialty Node profiles |
| 2 | Heavy footprint (JVM, lots of RAM) | Lightweight Node.js, SDK install |
| 3 | Every query hits every shard | Intent-based routing via Specialty Node |
| 4 | Domain logic is bolted on | First-class domain adapters |
| 5 | Hot shard problem (uneven load) | Specialty-based + internal sharding |
| 6 | No intent-aware query routing | Query Splitter + Specialty Node decide which nodes to call |
| 7 | Opaque ranking | Per-node scoring + transparent merge at Gateway |
| 8 | Single point of failure (gateway) | Load balancer + replicas |
| 9 | No two-level scaling (only horizontal) | Vertical (specialty) + Horizontal (shards inside specialty) |

---

## 2. Node Roster (Final)

### Core Nodes (from the original diagram — kept)

| Node | Role | Algorithm |
|---|---|---|
| **Gateway** | Entry point, routing, merge & rank | Weighted score fusion |
| **Query Splitter** | Breaks query, asks Specialty Node which nodes to call | Intent classification |
| **Text Node** | Full-text fields (description, body) | BM25 / TF-IDF |
| **Metadata Node** | Structured fields (price, author, category) | Exact match + filter |
| **Tags Node** | Labels, keywords, hashtags | Jaccard similarity / set overlap |
| **Index Nodes** | Receive new documents, distribute to search nodes | Hash-based chunking |
| **Specialty Node** | Holds domain profiles and routing rules | Rule lookup table (rules → ML later) |
| **Merge & Rank** | Combines results from all nodes | Late fusion + normalization |

### New Helper Nodes (added to fill gaps)

| Node | Role | Why |
|---|---|---|
| **Cache Node** | Stores recent query results | Fast repeat queries |
| **Replica Nodes** (per specialty) | Backup copy of each Search Node | Fault tolerance |
| **Schema Registry Node** | Stores all domain adapter definitions | Dynamic domain support |
| **Feedback / Analytics Node** | Records click data and user signals | Self-improving ranking |
| **Coordinator Node** | Watches node health, manages failover | Frees Gateway from monitoring |
| **Load Balancer** | Routes traffic across multiple Gateway copies | No SPOF (single point of failure) |
| **Cluster Manager** | Tracks live nodes, replica locations, leader | Service discovery |
| **WAL (Write-Ahead Log)** | Logs every write before applying | Crash recovery / durability |

---

## 3. Scaling Strategy — How the System Handles Big Data

### Which Algorithm Carries the Load When Data Grows?

| Layer | Algorithm | Scales with data? |
|---|---|---|
| **Text Node** | BM25 | YES — heavy (text is the largest field) |
| **Metadata Node** | Exact match + filter | YES — light (small structured fields) |
| **Tags Node** | Jaccard | YES — moderate |
| **Gateway (Merge)** | Late fusion | NO — only merges small top-K |
| **Specialty Node** | Routing rules | NO — same speed at 1k or 1B docs |
| **Schema Registry** | Lookup | NO — tiny |

**Conclusion:** the 3 Search Nodes do the heavy lifting at scale. They must use efficient data structures.

### The Trick — Inverted Index

Each Search Node stores its data as an **inverted index** — a structure that maps `term → list of documents containing it`. Like the index at the back of a book. Searching takes 1 lookup, not a full scan.

| Node | Inverted index looks like |
|---|---|
| Text Node | `"wireless" → [doc1, doc5, doc77 ...]` |
| Metadata Node | `brand:"Sony" → [doc2, doc8 ...]` |
| Tags Node | `tag:"bluetooth" → [doc1, doc4, doc9 ...]` |

### Two-Level Scaling (Research Contribution)

When ONE specialty node grows too big, split it horizontally into **shards** (slices of data). Each shard runs the same algorithm in parallel.

```
                       Text Node (logical)
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         Text Shard 1   Text Shard 2   Text Shard 3
         (docs A-H)     (docs I-P)     (docs Q-Z)
         [BM25]         [BM25]         [BM25]
```

- **Vertical split** = Text vs Metadata vs Tags (your specialty design)
- **Horizontal split** = Shard 1, 2, 3 inside each specialty (for big data)
- **Both together = two-level scaling.** Most existing systems only do one.

Each specialty grows **independently** — if text data grows fast but tags don't, only add Text Shards. Saves cost.

---

## 4. SEARCH Flow Architecture (v2)

### Important — Specialty Node is an Advisor, NOT a Pipeline Step

The query **does NOT pass through Specialty Node**. The Query Splitter only **asks** Specialty Node for advice (which nodes to call), gets an answer, then sends the real query to the chosen Search Nodes.

Think of it like a **phone call**:
> Splitter calls Specialty Node → "Which nodes for this query?"
> Specialty Node replies → "Call Text + Metadata, skip Tags."
> Splitter hangs up, then sends query to those nodes.

That is why the diagram shows **two arrows** between them — one question, one answer — but no data flows through.

### Step-by-Step (example: search "wireless headphones under $200")

| Step | Where | What happens |
|---|---|---|
| 1 | Client → Gateway | User query arrives |
| 2 | Gateway → Query Splitter | Splits into text + numeric parts |
| 3 | Query Splitter ↔ Specialty Node | Asks "which nodes?", gets answer |
| 4 | Query Splitter → selected Search Nodes (parallel) | Sends query only to chosen ones |
| 5 | Search Nodes → Merge & Rank | Each returns top-K, gateway combines |
| 6 | Merge & Rank → Client | Final ranked results |

### Diagram

```
                                                       ┌────────────────────┐
                                                       │  Specialty Node    │
                                                       │ (routing rules per │
                                                       │  domain — ADVISOR  │
                                                       │  only, no data     │
                                                       │  flows through)    │
                                                       └─────▲────────┬─────┘
                                                             │        │
                                                  "which nodes?"   "call Text
                                                             │     + Metadata"
                                                             │        │
   ┌────────┐                ┌─────────┐               ┌─────┴────────▼─────┐
   │        │   User Search  │   ▒▒▒   │               │      ◇◇◇           │
   │ Client │ ──── Query ──▶ │ Gateway │ ─────────────▶│   Query Splitter   │
   │        │                │   ▒▒▒   │               │      ◇◇◇           │
   └────▲───┘                └─────────┘               └─────────┬──────────┘
        │                         │                              │
        │                         ▼                              │
        │                  ┌────────────┐                        │
        │                  │ Cache Node │ ◀── check first        │
        │                  │  (recent)  │     (skip if miss)     │
        │                  └────────────┘                        │
        │                                                        │
        │                              ┌─────────────────────────┤
        │                              │           │             │
        │                              ▼           ▼             ▼
        │     Search Nodes:       ┌────────┐ ┌─────────┐  ┌────────┐
        │                         │  ████  │ │  ████   │  │  ████  │
        │                         │  Text  │ │Metadata │  │  Tags  │
        │                         │  Node  │ │  Node   │  │  Node  │
        │                         │ [BM25] │ │ [exact] │  │[Jaccard]│
        │                         │  ████  │ │  ████   │  │  ████  │
        │                         └───┬────┘ └────┬────┘  └───┬────┘
        │                             │           │           │
        │             (each node can split into internal shards for big data)
        │                             │           │           │
        │                             └───────────┼───────────┘
        │                                         ▼
        │  Search Results            ┌──────────────────────────┐
        └────────────────────────────│  Merge and Rank Results  │
                                     │  (late fusion + norm.)   │
                                     └──────────────────────────┘

   Side helpers (not on main path):
   • Replica Nodes      → backup for Text / Metadata / Tags (used if main fails)
   • Feedback Node      → logs which result the user clicked (for future ranking)
   • Coordinator Node   → watches health, swaps in replicas
   • Cluster Manager    → tracks live nodes, leader, replica locations
   • Load Balancer      → fronts multiple Gateway copies (removes SPOF)
```

### Why Each Algorithm Fits Its Node

The algorithm must match the **shape of the data** in each node.

| Node | Data Shape | Algorithm | Why It Fits |
|---|---|---|---|
| **Text Node** | Long unstructured words (titles, descriptions) | **BM25** | Scores by word frequency + rarity + doc length — perfect for free text |
| **Metadata Node** | Fixed-value structured fields (price, brand) | **Exact match / filter** | Values are discrete; no need for fuzzy math; fast lookup |
| **Tags Node** | Sets of labels (`{wireless, bluetooth}`) | **Jaccard similarity** | Tags have no frequency; set overlap is the natural metric |

**BM25 example** — search "wireless headphones":
- Doc that mentions both 3 times → high score
- Doc that mentions one once → medium score
- Doc with neither → 0

**Exact match example** — filter `brand=Sony AND price<200`:
- Sony @ $150 → match
- Sony @ $300 → no match (price too high)
- JBL @ $150 → no match (wrong brand)

**Jaccard example** — query tags `{wireless, audio}`:
- Doc tags `{wireless, bluetooth, audio}` → shared 2, total 3 → 0.67
- Doc tags `{wireless, gaming}` → shared 1, total 3 → 0.33

Using BM25 on metadata or Jaccard on text would give bad results. Wrong tool for the data.

---

## 5. STORE Flow Architecture (v2)

### Step-by-Step (example: register a product)

Document being registered:
```json
{
  "id": "prod_42",
  "title": "Wireless Sony Headphones",
  "description": "Bluetooth noise-cancelling headphones",
  "price": 199,
  "brand": "Sony",
  "tags": ["wireless", "bluetooth", "audio"]
}
```

| Step | Where | What happens |
|---|---|---|
| 1 | Client → Gateway | New doc arrives |
| 2 | Gateway → Index Node | Gateway just routes — no processing |
| 3 | Index Node ↔ Schema Registry | Asks for field mapping for domain `ecommerce` |
| 4 | Index Node → WAL | Write-ahead log entry (durability) |
| 5 | Index Node → Shard Cluster | Hash(prod_42) picks Shard 2 → stores full raw doc |
| 6 | Index Node → Specialty Node | Notifies "new doc in ecommerce" → updates routing profile |
| 7 | Index Node → all 3 Search Nodes (parallel) | Text Node builds BM25 index of title+description; Metadata Node builds filter index of price+brand; Tags Node builds set index of tags |
| 8 | All confirm back to Index Node | Once all done |
| 9 | Index Node → Gateway → Client | Response 200 |

### What is Index Node?

**Index Node = registration desk of the search engine.** The boss of STORE.

Its job:
- Receive new docs from Gateway
- Look up domain rules (Schema Registry)
- Save raw doc to Shard Cluster
- Notify Specialty Node about new data
- Fan out the doc to all 3 Search Nodes for indexing
- Wait for all confirmations before returning success
- Write to WAL for crash recovery

Why separate from Gateway? Gateway handles ALL traffic (search + store + health) and stays lightweight. Index Node specializes in writes — heavy parsing, distribution, waiting for confirmations. Splitting them keeps search fast even when writes are heavy.

### What is Shard Cluster?

**Shard Cluster = raw document storage. Source of truth.**

Different from the indexes inside Search Nodes:

| Place | Stores | Format |
|---|---|---|
| **Shard Cluster** | Full original document (all fields) | Raw JSON / record |
| **Text Node** | Only text fields | Inverted index |
| **Metadata Node** | Only metadata fields | Filter index |
| **Tags Node** | Only tag fields | Set index |

Why we need raw storage:

| Reason | Explanation |
|---|---|
| **Source of truth** | If a Search Node dies, rebuild its index from raw docs |
| **Show full doc** | When user clicks a result, we display ALL fields, not just searched ones |
| **Updates / deletes** | To modify a doc, we need the original |
| **Re-indexing** | Changed your algorithm? Re-process from Shard Cluster |
| **Disaster recovery** | Safe copy if everything else fails |

Documents split by `hash(doc_id)` across machines. Adding more shards = more capacity. This is **horizontal scaling** of raw storage.

### Two Kinds of Shards — Don't Confuse Them

| Type | Lives Under | Stores | Used For |
|---|---|---|---|
| **Shard Cluster** | Index Node | Full raw docs | Recovery, retrieval |
| **Search Node Shards** | Inside Text/Metadata/Tags | Processed inverted indexes | Fast search |

Both use hash-based splitting, but they serve different jobs.

### Diagram

```
                                                                 Response OK (200)
                                              ┌──────────────────────────────────┐
                                              │                                  │
                                              │                                  │
   ┌────────┐                ┌─────────┐      │   ┌────────────┐                 │
   │        │   Register     │   ▒▒▒   │      │   │   ████     │                 │
   │ Client │ ── new ─────▶  │ Gateway │ ─────┴──▶│ Index Node │                 │
   │        │  item/webpage  │   ▒▒▒   │          │  (boss of  │                 │
   └────────┘                └─────────┘          │   STORE)   │                 │
                                                  │   ████     │                 │
                                                  └──┬──┬──┬───┘                 │
                                                     │  │  │                     │
                            ┌────────────────────────┘  │  └──────────────┐      │
                            │                           │                 │      │
                  ask Schema Registry                   │                 │      │
                  (field mapping)                       │                 │      │
                            │                           │                 │      │
                            ▼                           ▼                 ▼      │
                 ┌────────────────────┐      ┌────────────────────┐  fan out to  │
                 │  Schema Registry   │      │   Shard Cluster    │  3 Search    │
                 │                    │      │ ┌──┐┌──┐┌──┐┌──┐   │  Nodes       │
                 │ text=[title,desc]  │      │ │S1││S2││S3││S4│   │              │
                 │ meta=[price,brand] │      │ └──┘└──┘└──┘└──┘   │              │
                 │ tags=[tags]        │      │ (raw original docs)│              │
                 └────────────────────┘      └─────────┬──────────┘              │
                                                       │                         │
                                                       ▼ notify new doc          │
                                            ┌────────────────────┐               │
                                            │  Specialty Node    │               │
                                            │ (update routing    │               │
                                            │  profile for       │               │
                                            │  this domain)      │               │
                                            └────────────────────┘               │
                                                                                 │
                                                       ┌─────────────────────────┘
                                                       │
                                       ┌───────────────┼───────────────┐
                                       ▼               ▼               ▼
                                  ┌────────┐     ┌─────────┐     ┌────────┐
                                  │  ████  │     │   ████  │     │  ████  │
                                  │  Text  │     │Metadata │     │  Tags  │
                                  │  Node  │     │  Node   │     │  Node  │
                                  │ [BM25] │     │ [exact] │     │[Jaccard]│
                                  │  ████  │     │   ████  │     │  ████  │
                                  └────────┘     └─────────┘     └────────┘
                                  (each builds its own specialized index)
                                       │             │              │
                                       ▼             ▼              ▼
                                  [replica]     [replica]       [replica]

   Side helpers:
   • Schema Registry  → domain field-mapping library (consulted on every register)
   • WAL              → write-ahead log (every change saved before applying)
   • Coordinator      → confirms write reached primary + replicas
   • Cluster Manager  → tracks where each shard lives
```

---

## 6. Algorithm Plan (Brief — Details Later)

| Layer | Algorithm Family | Notes |
|---|---|---|
| Text Node | BM25 (or TF-IDF as baseline) | Industry standard for text relevance |
| Metadata Node | Exact match + filter scoring | Fast structured lookup |
| Tags Node | Jaccard similarity / set overlap | Optimized for short labels |
| Query Splitter | Lightweight intent classifier | Rule-based first, ML later |
| Specialty Node | Routing decision table | Rule-based v1, ML classifier v2 |
| Gateway Merge | Late fusion with normalization | Combines scores fairly across specialties |
| Feedback Node | Click-through ranking signals | Future: learning-to-rank model |

(Algorithms will be designed in detail in a separate phase.)

---

## 7. Algorithm Locations — Who Does What

| Where | Algorithm Type | Purpose |
|---|---|---|
| **Text/Metadata/Tags Nodes** | Ranking | Score documents inside the node |
| **Gateway (Merge & Rank)** | Merging | Combine top-K from each node |
| **Specialty Node** | Routing / Decision | Pick which nodes to call per query |
| **Schema Registry** | Lookup only (no algorithm) | Holds domain field mappings |
| **Cache Node** | Hash lookup (no scoring) | Speed up repeat queries |
| **Feedback Node** | Click aggregation (future ML) | Improve ranking over time |

---

## 8. Helper Nodes Explained (Simple Language)

These nodes are not in your original diagram. They are **added around it** to fix known gaps in existing systems.

| # | Node | Simple Job | Real-Life Analogy |
|---|---|---|---|
| 1 | **Cache Node** | Remembers recent searches so we don't repeat work | Sticky note: "yesterday someone asked this, here's the answer" |
| 2 | **Replica Nodes** | Backup copies of Text/Metadata/Tags Nodes | A spare key for your house |
| 3 | **Coordinator Node** | Watches health of all nodes, switches to backup if one fails | Hospital nurse checking on patients |
| 4 | **Cluster Manager** | Keeps list of who is alive and where they live | Office attendance register |
| 5 | **Load Balancer** | Spreads traffic across many Gateway copies | Traffic policeman sending cars to different lanes |
| 6 | **WAL (Write-Ahead Log)** | Saves every change in a log before applying | Writing down what you spend before paying |
| 7 | **Feedback Node** | Watches what users click on, helps improve ranking | Shopkeeper noticing which items people buy most |

### 1. Cache Node

Many users search the same thing (e.g. "iphone 13"). Instead of running the same search again and again, the Cache Node **remembers the answer for a short time**. Next time the same query comes, it returns the saved answer instantly.

- **Sits between** Gateway and Search Nodes
- **Fills gap:** speed for repeated queries

### 2. Replica Nodes

Each Search Node (Text, Metadata, Tags) gets a **twin brother on another machine**. If the main node dies, the twin takes over. Search keeps working with no data loss.

- **One replica per Search Node** (or more)
- **Fills gap:** fault tolerance (no single point of failure)

### 3. Coordinator Node

A small node that pings every other node every few seconds: *"Are you alive?"* If a node does not reply, Coordinator switches traffic to the replica.

- **Frees Gateway** from health monitoring
- **Fills gap:** auto-recovery when nodes fail

### 4. Cluster Manager

A simple list — like an attendance register. It knows: *"Text Node main is on machine A, its replica is on machine B, Shard 3 is on machine C."* Any node that needs to find another, asks Cluster Manager.

- **Holds membership info** only
- **Fills gap:** service discovery in a moving system

### 5. Load Balancer

If 1000 users hit your engine at once, one Gateway cannot handle them. So you run **many Gateway copies**. The Load Balancer sits in front and sends each user to a different Gateway.

- **Removes Gateway as single point of failure**
- **Fills gap:** scalability and high availability

### 6. WAL (Write-Ahead Log)

Before saving any new document, Index Node writes a note in a log: *"About to save prod_42 with fields X, Y, Z."* Then it does the real save. If the machine crashes in the middle, the log lets us finish or undo cleanly.

- **Used by:** Index Node, Search Nodes
- **Fills gap:** durability and crash recovery

### 7. Feedback Node

Records which result a user clicks after searching. Over time, the system learns: *"for this kind of query, people prefer this kind of result."* Future searches get smarter.

- **Side path, never blocks search**
- **Fills gap:** self-improving ranking (research strength)

---

## 9. What's New vs. Original Diagram

| Element | Status |
|---|---|
| Gateway | Kept |
| Query Splitter | Kept |
| Text / Metadata / Tags Nodes | Kept |
| Index Nodes | Kept |
| Specialty Node | Kept — now has clear job (domain routing brain) |
| Merge & Rank | Kept |
| Shard Cluster (horizontal split inside nodes) | NEW |
| Cache Node | NEW |
| Replica Nodes | NEW |
| Schema Registry | NEW |
| Feedback / Analytics Node | NEW |
| Coordinator Node | NEW |
| Load Balancer | NEW |
| Cluster Manager | NEW |
| WAL | NEW |

---

## 10. Research Story (One Paragraph)

> Existing distributed search engines use a one-size-fits-all design where every query hits every shard, domain logic is bolted on as plugins, and ranking is opaque. This research proposes a *specialty-partitioned, intent-routed* distributed search engine, packaged as an SDK any domain can integrate. The system splits data vertically by field type (text, metadata, tags), routes queries based on intent via a Specialty Node holding domain profiles, applies a specialized algorithm at each node (BM25, exact match, Jaccard), and merges with late fusion at the gateway. For big data, each specialty further splits horizontally into shards — combining vertical and horizontal scaling. Helper components (cache, replicas, schema registry, feedback loop, coordinator, WAL) address fault tolerance, dynamic domain support, durability, and self-improvement.
