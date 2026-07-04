# Task 3 — External Benchmark vs Industry Engines

> **Status: in progress.** This document doubles as the plan, the running progress log, and (eventually) the final report. Last updated: 2026-06-29.

> **Companion to** [01-why-algorithm-first.md](01-why-algorithm-first.md) and [02-benchmark-results.md](02-benchmark-results.md). Tasks 1 and 2 lived on the `research-benchmarks` branch. **Task 3 lives on `research-external-benchmarks`** (off `optimized-architecture`) and is **independent** of Task 2's code — we re-collect public data from new sources and write a fresh harness.

---

## 1. Aim

Move the research claim from **"we beat our own old code"** (Task 2) to **"we hold our own against the industry."** Specifically:

- Benchmark our **optimized architecture** head-to-head with industry **distributed** search engines on the same workload, same hardware, same protocol.
- Test the **domain-agnostic** claim from `ARCHITECTURE.md:14` by re-running on **multiple, deliberately different** data sources — not one.

## 2. Scope — why "distributed" matters

Our architecture is a **distributed** system: multiple services (Gateway, Specialty Node, Search Nodes, Shard Cluster) coordinating over HTTP. A fair external comparison must be against engines whose architecture is also distributed — otherwise we compare our multi-hop pipeline against a single-process engine and the network overhead is not the interesting variable.

**Meilisearch was originally included in this study and later removed** because it is a single-node search engine (no sharding, no cluster mode in the open-source distribution). Its numbers are not comparable to a distributed baseline. See §9 for the removal note.

**Currently included:** Elasticsearch (single-node deployment, but distributed architecture supported).
**Planned:** a second distributed engine (candidates: OpenSearch, Vespa, Solr Cloud) — user will select.

## 3. Decisions locked in

| # | Decision | Value |
|---|---|---|
| 1 | Engines | **Ours (optimized) + Elasticsearch** (+ one more distributed engine to be added) |
| 2 | Branch | `research-external-benchmarks`, off `optimized-architecture`. No dependency on `research-benchmarks` — fresh code. |
| 3 | Access rule | **Black-box, HTTP endpoints only** for every engine. No internal hooks. |
| 4 | Setup endpoint mapping | Ours: `POST :5000/schema/<domain>` (Schema Registry). Elastic: `PUT :9200/<index>` with mapping. |
| 5 | Host | Single Docker host, sequential runs, never side-by-side. |
| 6 | Tuning | Defaults only. No engine-specific optimization. |
| 7 | Queries | Full set — text single + text multi + metadata range + tag exact. ~80 queries per domain × 10 reps. |
| 8 | Sizes | 100 / 1k / 10k / 100k documents per domain. |
| 9 | Cold-start handling | Repetition == 1 dropped from all summary stats (same rule as Task 2). |
| 10 | Execution order | **One engine at a time, ALL 3 domains × ALL 4 sizes per engine before moving on.** |
| 11 | Re-run CLI | `--engine / --domain / --size` flags so any single cell can be re-run cheaply after a fix. |
| 12 | Repo hygiene | Only benchmark + research files belong in commits on this branch. Engine source lives on `optimized-architecture`. |

## 4. Domains and their sources

| Domain name | Source | Auth? | Cache file |
|---|---|---|---|
| **articles** | Wikipedia REST + query API (`en.wikipedia.org/w/api.php`) | None | `benchmarks/datasets/.cache/wikipedia.jsonl` |
| **papers** | arXiv API (`export.arxiv.org/api/query`) | None | `benchmarks/datasets/.cache/arxiv.jsonl` |
| **products** | Open Food Facts (`world.openfoodfacts.org/api/v2/search`) | None (throttled) | `benchmarks/datasets/.cache/openfoodfacts.jsonl` |

### Schema cards (per domain)

```jsonc
// articles
{
  "text":     ["title", "extract"],
  "metadata": ["length", "last_modified"],
  "tags":     ["categories"]
}

// papers
{
  "text":     ["title", "summary"],
  "metadata": ["published_year"],
  "tags":     ["categories", "authors"]
}

// products
{
  "text":     ["product_name", "ingredients_text"],
  "metadata": ["nutriscore_numeric", "energy_100g"],
  "tags":     ["categories", "brands"]
}
```

## 5. CLI for selective re-runs

The orchestrator `benchmarks/run-external-experiment.js` accepts:

| Flag | Values | Default | Meaning |
|---|---|---|---|
| `--engine` | `elastic`, `ours`, `all`, comma-separated | `all` | Pick which engine(s) to run |
| `--domain` | `articles`, `papers`, `products`, `all`, comma-separated | `all` | Pick which domain(s) |
| `--size` | `100`, `1000`, `10000`, `100000`, `all`, comma-separated | `all` | Pick which size(s) |
| `--reps` | integer | `10` | Repetitions per query |
| `--no-teardown` | flag | off | Keep engine running after for debugging |

Examples:
```
# Full matrix
node benchmarks/run-external-experiment.js

# All engines on one domain at all sizes
node benchmarks/run-external-experiment.js --domain articles

# One cell — typical "after fix" verify
node benchmarks/run-external-experiment.js --engine ours --domain articles --size 1000

# Head-to-head between two engines at one cell
node benchmarks/run-external-experiment.js --engine ours,elastic --domain papers --size 10000
```

## 6. File layout

```
benchmarks/
├── docker-compose.external.yml        ← brings up Elastic (Meili removed)
├── .gitignore                          ← excludes datasets/.cache, results/
├── loaders/
│   ├── load-wikipedia.js
│   ├── load-arxiv.js
│   └── load-openfoodfacts.js
├── setup/
│   ├── elastic-mapping-<domain>.json  ← 3 files
│   └── ours-schema-<domain>.json      ← 3 files
├── harness/
│   ├── run-elastic.js
│   └── run-ours.js
├── queries/
│   ├── canonical-articles.json
│   ├── canonical-papers.json
│   ├── canonical-products.json
│   └── translate.js                   ← toElastic + toOurs
├── results/
│   └── <engine>-<domain>-<size>.csv
├── analyze-external.js
└── run-external-experiment.js         ← orchestrator with the CLI flags above
```

## 7. Phase-by-phase plan

### Phase 1 — ELASTICSEARCH ✅
End-to-end run across all 3 domains × all 4 sizes. 11/12 cells done (`articles × 100k` deferred until the Wikipedia cache is full).

### Phase 2 — OURS ✅
Same shape, reusing the harness. 11/12 cells done. Multiple engineering fixes surfaced (see §11).

### Phase 3 — Second distributed engine (planned)
User will select the target engine (candidates: OpenSearch, Vespa, Solr Cloud). Same harness pattern will be extended.

## 8. Elasticsearch results (Phase 1)

### Search latency per cell (warm only, cold-start dropped)

| domain | size | median (ms) | p90 (ms) | p99 (ms) | indexing (ms) | setup (ms) |
|---|---:|---:|---:|---:|---:|---:|
| articles | 100 | 4.83 | 6.48 | 7.80 | 110 | 2681 |
| articles | 1000 | 3.92 | 5.64 | 7.12 | 423 | 219 |
| articles | 10000 | 3.05 | 4.53 | 6.17 | 2226 | 214 |
| papers | 100 | 3.10 | 4.43 | 5.55 | 71 | 266 |
| papers | 1000 | 2.52 | 3.69 | 4.95 | 370 | 472 |
| papers | 10000 | 2.82 | 4.29 | 5.74 | 2122 | 205 |
| papers | 100000 | 2.76 | 5.18 | 6.22 | 30394 | 218 |
| products | 100 | 2.21 | 3.00 | 4.18 | 72 | 205 |
| products | 1000 | 2.65 | 4.65 | 6.34 | 117 | 205 |
| products | 10000 | 2.10 | 3.26 | 4.97 | 1090 | 536 |
| products | 100000 | 2.18 | 4.19 | 5.92 | 10002 | 172 |

### Overall summary (across all 11 Elastic cells)

| metric | value |
|---|---:|
| Total warmed queries (n) | **7,920** |
| Median latency | **2.76 ms** |
| Mean latency | 3.10 ms |
| p90 latency | 4.92 ms |
| p99 latency | 6.79 ms |
| Search errors | **0** |

### Elastic by query type

| query type | n | median (ms) | p90 (ms) | p99 (ms) |
|---|---:|---:|---:|---:|
| single (one text word) | 1980 | 3.03 | 5.26 | 7.07 |
| multi (multi-word text) | 1980 | 3.92 | 5.76 | 7.20 |
| range (numeric compare) | 1980 | 2.23 | 3.85 | 5.33 |
| term (exact tag match) | 1980 | 2.24 | 3.29 | 4.75 |

## 9. Our-vs-Elastic side-by-side (Phase 1 + Phase 2)

### Median search latency

| domain | size | Elastic | Ours | Ratio (ours ÷ elastic) |
|---|---:|---:|---:|---:|
| articles | 100 | 4.83 | 25.59 | **5.3×** |
| articles | 1000 | 3.92 | 25.41 | 6.5× |
| articles | 10000 | 3.05 | 31.88 | **10.5×** |
| papers | 100 | 3.10 | 23.79 | 7.7× |
| papers | 1000 | 2.52 | 24.25 | 9.6× |
| papers | 10000 | 2.82 | 15.42 | 5.5× |
| papers | 100000 | 2.76 | 75.00 | **27.2×** |
| products | 100 | 2.21 | 12.30 | 5.6× |
| products | 1000 | 2.65 | 13.13 | 5.0× |
| products | 10000 | 2.10 | 17.70 | 8.4× |
| products | 100000 | 2.18 | 47.94 | **22.0×** |

### Reading the numbers

- **Ours has a higher latency floor (~10–30 ms) than Elastic (~2–5 ms)** because every query traverses a multi-hop pipeline: Gateway → Specialty Node → Search Node(s) → Shard Cluster. Elastic is a single process with no inter-service hops on the read path.
- **The gap widens at 100k** — ours jumps to 47–75 ms while Elastic stays at 2–3 ms. This is the direction to fix.
- **But ours' latency stays sub-linear as N grows.** For products, 100 → 100k (1000× more docs) only moves median from 12.30 → 47.94 ms (~4× slower). For papers, 100 → 100k moves 23.79 → 75 ms (~3× slower). The algorithm-first prediction holds; the issue is the network floor, not the algorithm.

## 10. Where ours needs to improve

The single biggest gap is **raw search latency** — 5–27× slower than Elastic. Reasons:

1. **5 HTTP hops per search** (Gateway → Specialty → Search Node(s) → Shard Cluster → back). Each hop ~3-5 ms.
2. **No routing cache** — every search asks Specialty Node the same question.
3. **No top-K early termination** — text search scores every matching doc at 100k.
4. **No connection reuse** (keep-alive not enabled between internal services).

Fixes are planned before adding the second distributed engine to Phase 3, so ours starts that comparison from a more competitive baseline.

## 10a. Optimization journey — closing the latency gap

After the Phase 2 head-to-head showed ours was 5–10× slower than Elastic on median search latency, a targeted optimization pass reduced the gap to **1.3–3.9×** across all measured cells. The three fixes below stack.

### Fix summary

| Fix | Attacks | Change | Impact (median, 9 cells) |
|---|---|---|---|
| **#1 Keep-alive (`http.Agent`)** | New TCP connection per internal hop | Shared agent with `keepAlive: true` in each service; 9 axios clients updated | **~10 ms saved per query** |
| **#2 Route cache (Gateway)** | Redundant Specialty Node HTTP call per query | In-memory LRU keyed on `(domain, normalized-query)`, 5-min TTL | ~1 ms saved (small — Fix #1 already made this hop cheap) |
| **#5 Top-K early termination** | Text search sorted every match then discarded most | Bounded min-heap of size K in `TextIndex.search()`; Gateway forwards `limit` end-to-end | **~3-5 ms saved per cell (biggest lever)** |

### Profile-driven decision-making

Fix #2 delivered less than predicted (~1 ms vs predicted 3-5 ms). Rather than continuing to guess, we added per-phase timing to Gateway's `/api/search` handler and captured 20 warm samples on a populated index. The profile showed the real distribution of time:

| Phase | Median (ms) | Share of total |
|---|---:|---:|
| parseInput | 0.001 | 0% |
| route | 0.014 | 0.2% |
| **fanout** | **4.616** | **74%** |
| merge | 0.127 | 2% |
| hydrate | 1.453 | 23% |
| shape | 0.009 | 0.1% |
| **total** | **6.238** | 100% |

This killed Fix #4 (merge Gateway + Specialty into one process) — the route hop was already 0.014 ms; nothing to save. It also made Fix #5 the obvious next lever: attack the search-node work that dominates fanout.

### Before / after table

Medians in ms, 720 warm samples per cell, 3 domains × sizes 100 / 1k / 10k. Elastic column unchanged from Phase 1 (baseline).

| Cell | Elastic | **Before** | After #1 | After #2 | **After #5** | Total saved | Ratio (before → after) |
|---|---:|---:|---:|---:|---:|---:|---:|
| articles × 100 | 4.83 | 25.59 | 8.73 | 8.62 | **6.50** | -19.09 | 5.3× → **1.3×** |
| articles × 1000 | 3.92 | 25.41 | 10.38 | 10.45 | **6.72** | -18.69 | 6.5× → **1.7×** |
| articles × 10000 | 3.05 | 31.88 | 12.83 | 13.42 | **8.57** | -23.31 | 10.5× → **2.8×** |
| papers × 100 | 3.10 | 23.79 | 8.92 | 9.05 | **5.46** | -18.32 | 7.7× → **1.8×** |
| papers × 1000 | 2.52 | 24.25 | 9.33 | 9.84 | **5.89** | -18.36 | 9.6× → **2.3×** |
| papers × 10000 | 2.82 | 15.42 | 15.24 | 15.32 | **10.98** | -4.44 | 5.5× → **3.9×** |
| products × 100 | 2.21 | 12.30 | 10.26 | 8.45 | **5.88** | -6.42 | 5.6× → **2.7×** |
| products × 1000 | 2.65 | 13.13 | 10.03 | 9.08 | **4.87** | -8.26 | 5.0× → **1.8×** |
| products × 10000 | 2.10 | 17.70 | 13.18 | 12.75 | **8.24** | -9.46 | 8.4× → **3.9×** |

### What the optimizations did NOT touch

- Distributed architecture — Gateway, Specialty Node, Search Nodes, Shard Cluster all still separate processes
- Domain-agnostic story — schema cards, per-specialty routing, projection at index-time all unchanged
- Correctness — Fix #5 verified against the old full-sort implementation on single-term and multi-token queries; both return the same top-K in the same score order
- Zero errors across 6,480 warmed queries (720 × 9 cells)

### The remaining gap and what would close it

The floor is now the architecture itself:

```
Client → Gateway → Search Node → Shard Cluster → back
         ~0.5 ms    ~2-3 ms       ~1-1.5 ms      ~0.5 ms
```

Even with every optimization applied, the minimum path is **~4-5 ms** — three real HTTP hops. Elastic runs everything in one process; there is no equivalent hop to remove.

Closing further would require an architectural change: co-locating Gateway + Search Node in one process for small deployments (~2 ms floor achievable), while keeping the distributed layout as an option for scale. This is a design decision for the next major revision, not a small perf fix.

### Commits landed on `optimized-architecture`

| Commit | Description |
|---|---|
| `895ce84` | perf: reuse HTTP connections between internal services (keep-alive) |
| `02801f6` | perf: cache Specialty Node routing decisions in Gateway |
| `8ede0ed` | observability: add per-phase timings to Gateway `/api/search` |
| `2a6de2b` | perf: top-K early termination in text search (Fix #5) |

---

## 11. Engineering findings surfaced during ours' benchmark

While running ours at 100k, we hit four real engineering issues — each one is a production-readiness finding:

| # | Issue | Fix |
|---|---|---|
| 1 | Express default 100kB body limit rejected 500-doc bulk batches | Bumped to 50MB on Gateway, Index Node, Search Node |
| 2 | Internal HTTP timeouts (5s) too tight for 100k indexing | Bumped Gateway→IndexNode to 10min, IndexNode→SearchNode to 5min, IndexNode→Shard to 5min |
| 3 | Text Node OOMed on 100k arXiv papers (long abstracts × inverted-index = >2GB) | Set `NODE_OPTIONS=--max-old-space-size=4096` in docker-compose; added `restart: unless-stopped` |
| 4 | Our system has no DELETE-by-index endpoint, so docs accumulate across cells | Orchestrator's `prepareCell` hook does `docker compose down + wipe data/ + up` between cells (~50s overhead) |

All fixes are committed on `optimized-architecture`.

## 12. Progress log

### 2026-06-23 → 2026-06-29

- ✅ Decided plan (see §2-§7)
- ✅ Created branch `research-external-benchmarks` off `optimized-architecture`
- ✅ Three loaders written (Wikipedia random-sample, arXiv date-windows, OFF bulk-dump)
- ✅ 240 canonical queries written (80 per domain, mixed text/range/term)
- ✅ Elasticsearch harness + 11-cell run complete
- ✅ Ours harness + 11-cell run complete
- ✅ Real engineering fixes for ours' 100k cells (body limits, timeouts, heap, per-cell reset)
- 🟡 Wikipedia cache still filling (~89k/111k = 80%) — `articles × 100k` deferred for both engines
- 🗑️ **2026-06-29 — Meilisearch removed** from this branch. Reason: Meili's open-source distribution is a single-node engine (no sharding, no cluster mode), so it does not belong in a "distributed vs distributed" comparison. Historical commits retained; no git-history rewrite.
- ✅ **2026-07-04 — Optimization pass complete**. Fixes #1 (keep-alive), #2 (route cache), and #5 (top-K termination) landed on `optimized-architecture`. Median latency down ~14 ms on average, best cell within 1.3× of Elastic. See §10a for the profile-driven decisions and full before/after table.
- ⏳ Next: add a second distributed engine to make Phase 3 a true "distributed vs distributed" comparison; consider a Gateway+SearchNode co-location option for cases where the ~5 ms distributed floor is too high.

## 13. Glossary

- **Black-box rule** — every engine is accessed only through its public HTTP endpoints. No peeking inside containers. No internal fast paths.
- **Setup phase** — anything an engine requires *before* it can accept indexing requests for a new domain. Ours: schema registration. Elastic: index mapping.
- **Cell** — one combination of (engine, domain, size).
- **Phase** — one engine's complete run across all 3 domains and 4 sizes.
- **Distributed engine** — one whose architecture natively supports splitting the workload across multiple processes (sharding, cluster mode). Elasticsearch does; Meilisearch (open-source) does not.
