# Semester Research Plan

> **One-line summary:** This semester we prove that the **3rd architecture** (the "optimized architecture" in the research presentation, on this branch) scales better than the **previous architecture** (on the `namenode` branch), and we explain *why* algorithm choice has to come first.

---

## 1. Why this semester exists

Last semester the reviewers asked one big question:

> **"Why do we need to choose the best algorithm? Why should choosing the best algorithm be the first priority?"**

This semester we answer that question in **two ways**:

1. **Theoretically** — write the argument (algorithm sets the scaling ceiling, hardware cannot break it).
2. **Empirically** — prove it with a real benchmark on our own two architectures.

---

## 2. The two architectures we are comparing

| | Previous architecture | 3rd architecture (optimized) |
|---|---|---|
| Git branch | `namenode` | `3rd-Architecture` (current) |
| Design style | Classic **MapReduce** pipeline (HDFS-style name node + map + reduce + search) | **Distributed search engine** (Gateway + Specialty Node + Index Node + 3 Search Nodes + Shard Cluster) |
| Index | Static `index.json` — rebuilt offline by MapReduce | Dynamic, in-memory inverted index per specialty (text / metadata / tags) |
| Query types | **Text-only**, single-word lookup (`GET /search?q=word`) | Text + metadata (`calories<300`) + tags (`cuisine:italian`) + compound (`POST /api/search`) |
| Document growth | Must regenerate splits + rebuild whole index | Incremental — just POST `/api/index` |
| Sharding | None | Yes — hash-by-id over N shards in Shard Cluster |
| Late hydration | Not applicable (returns from one file) | Yes — Search Nodes return `{id, score}` only; Gateway batch-hydrates top-K from Shard Cluster |
| Parallelism | Serial pipeline | Parallel specialty nodes |

**Terms defined inline:**
- **MapReduce** = a batch pipeline style where data is first "mapped" (broken into pieces) then "reduced" (combined into one output). Good for offline processing, bad for fast live queries.
- **Sharding** = splitting data into many small buckets so each bucket can be searched in parallel.
- **Late hydration** = "find the IDs first, fetch the full document only at the end." Saves network bandwidth because we do not move full docs through every step.

---

## 3. The two semester tasks

### Task 1 — Theory: "Why algorithm-first?"

**Deliverable:** a written research section.
**Path:** [docs/research/01-why-algorithm-first.md](01-why-algorithm-first.md) (to be created)

**Claim to defend:**
> Algorithm choice sets the **scaling ceiling** of any system. Hardware can give a constant speed-up (2×, 10×); algorithm choice can give a scaling speed-up (1,000× and beyond as data grows). Therefore, the algorithm must be chosen **first** — every other decision (hardware, data layout, network) only optimizes *inside* the ceiling that the algorithm set.

**Sections the document will cover:**
1. The reviewer's question, restated.
2. Hardware vs algorithm — the constant-factor vs scaling-factor distinction.
3. A worked numerical example (100 docs vs 100,000 docs; linear scan vs sharded inverted index).
4. Why retrofitting a better algorithm later is expensive or impossible.
5. How this principle drove the 3rd architecture's design (sharding, late hydration, parallel specialty nodes).
6. A diagram showing the two scaling curves — flat vs climbing.

### Task 2 — Empirical: head-to-head benchmark

**Deliverable:** a written research section + raw data + chart.
**Paths:**
- [docs/research/02-benchmark-results.md](02-benchmark-results.md) (to be created)
- `benchmarks/results/*.csv` (raw timings)

**Method (one paragraph):** pick one synthetic dataset, run it on both architectures at sizes **100, 1k, 10k, 100k** documents, fire **20 fixed text-only queries** (the common subset both architectures can answer) ten times each, and measure **end-to-end latency from the client's wall-clock**. Compute the delta (size 100 → size 100k) on each branch. The new architecture's delta should be **near zero**; the old architecture's delta should **climb visibly**.

**Common subset rule:** the old architecture only supports single-word text search. So the fair head-to-head query set is text-only. We will **separately** also benchmark the *full* query set (metadata / tags / compound) on the new architecture, to showcase its extra power.

---

## 4. Decisions already locked in

| Question | Decision | Why |
|---|---|---|
| Dataset | **Synthetic, seeded** (no MovieLens / Amazon) | Exact sizes, reproducible, no licence, fits our schema |
| Sizes | 100, 1k, 10k, 100k | 4 points = clear curve, not just 2 |
| Queries | 20 fixed, text-only, repeated ×10 | Lowest common denominator both branches can run |
| Latency measurement | **Client-side wall-clock** (request sent → response received) | Reflects real user experience |
| Metrics reported | avg, p50, p95, p99, throughput (q/s), CPU%, memory MB | Richer report = stronger claim |
| Where the work goes | New folder `benchmarks/` + `docs/research/` | Zero changes to either production architecture |
| Where on git | New branch `research-benchmarks` from `3rd-Architecture` | Keeps the main branch clean for code review |

**Terms defined inline:**
- **p50 / p95 / p99** = "50th / 95th / 99th percentile latency." Half of requests finish faster than p50; 99% finish faster than p99. p99 is the worst-case experience.
- **Throughput** = how many queries per second the system can handle.
- **Seeded synthetic data** = data generated by a program using a fixed random seed, so the same seed always produces the same data — anyone can re-run our experiment and get the same numbers.

---

## 5. The step-by-step execution plan

Each step ends with a checkpoint. Nothing in the production code (either branch) is touched.

| # | Step | What gets created | Checkpoint |
|---|---|---|---|
| 1 | Write `01-why-algorithm-first.md` (Task 1 theory) | One new MD file | User reads, approves argument |
| 2 | Build synthetic data generator (TDD) | `benchmarks/generate-dataset.js` + tests | User runs it, checks output |
| 3 | Build query set | `benchmarks/queries/text-queries.json` | User inspects |
| 4 | Build harness for new architecture (TDD) | `benchmarks/harness/run-new.js` | User runs it against live new stack |
| 5 | Build harness for old architecture (TDD) | `benchmarks/harness/run-old.js` | User runs it against live old stack |
| 6 | Build metrics + resource collector (TDD) | `benchmarks/harness/metrics.js`, `resources.js` | Smoke check on small sample |
| 7 | Run the full experiment, both branches, all 4 sizes | Generates all `results/*.csv` | User sees raw numbers |
| 8 | Build the analyzer (TDD) | `benchmarks/analyze.js` | Produces summary table + chart data |
| 9 | Write `02-benchmark-results.md` (Task 2 report) | One new MD file | Final research deliverable |
| 10 | Commit + push to `research-benchmarks` branch | Clean PR-ready branch | Ready for presentation |

---

## 6. Folder layout (when finished)

```
docs/
└── research/
    ├── 00-semester-plan.md          ← this file
    ├── 01-why-algorithm-first.md    ← Task 1 deliverable
    └── 02-benchmark-results.md      ← Task 2 deliverable

benchmarks/
├── README.md
├── generate-dataset.js
├── datasets/                        ← gitignored
├── queries/
│   └── text-queries.json
├── harness/
│   ├── run-new.js
│   ├── run-old.js
│   ├── metrics.js
│   └── resources.js
├── results/                         ← gitignored
└── analyze.js
```

---

## 7. Open items (things to decide as we go)

- [ ] **Synthetic data shape.** Step 2 will propose a generator that creates docs with `title`, `description`, `price`, `rating`, `tags`. User will see and approve sample output before bulk generation.
- [ ] **How to grow the old architecture's dataset.** Old branch rebuilds the whole index from text splits, so growing from 100 to 100k means regenerating the splits and re-running the whole compose stack. The harness for old will handle this.
- [ ] **Exact 20 text queries.** We will pick words that exist across all 4 dataset sizes (so the query is comparable at every size).
- [ ] **Where the chart gets rendered.** `analyze.js` writes chart data as CSV; final chart can be drawn in Excel or Google Sheets for the presentation slides. (We can revisit if you want it auto-rendered as PNG.)

---

## 8. Quick reference — what each branch looks like at a glance

### `namenode` (previous architecture)
```
cleaner → namenode → crawler → map → reduce → search-api (port 3000, GET /search?q=word)
                              │
                              └── builds /dfs/index.json (static)
```

### `3rd-Architecture` (current, optimized)
```
Client → Gateway (3000) → Specialty Node (6000) → Index Node (4001) ──┬─→ Text Node (3001)
                                                                       ├─→ Metadata Node (3002)
                                                                       └─→ Tags Node (3003)
                              ↑                                        ↓
                              └──── Shard Cluster (7000) ──── (late hydrate top-K)
```

---

## 9. Glossary (for anyone reading this later)

- **Architecture** — the overall shape and design of a software system (which components exist, how they talk to each other).
- **Benchmark** — a controlled measurement experiment that compares two systems under the same workload.
- **Delta (Δ)** — the difference between two measurements. Here: how much latency grew when the dataset grew.
- **Domain-agnostic** — not tied to one type of data. Our system can index recipes, movies, products, anything — without code changes, just by registering a new schema.
- **End-to-end latency** — the time from when the user presses Enter to when the result appears on screen.
- **Inverted index** — a map from "word → list of documents containing the word." The standard data structure powering text search.
- **Schema** — the declaration of which fields a domain has and which type each field is (text vs metadata vs tags).
- **Specialty Node** — in the new architecture, a Search Node that handles only one type of query (text OR metadata OR tags). Lets each node be optimized for its job.
