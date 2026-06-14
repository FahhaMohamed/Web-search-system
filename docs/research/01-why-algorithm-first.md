# Why Algorithm-First? Why the Best Algorithm Must Be Priority Number One

> **The question we are answering:** Why do we need to choose the best algorithm? Why should choosing the best algorithm be the first priority — before hardware, before networking, before data layout, before anything else?
>
> **The short answer:** Algorithm choice sets a **scaling ceiling** that no amount of hardware can break through. Hardware gives a one-time speed-up; the algorithm decides how the work grows when the data grows. Once a system is built around an algorithm, that algorithm becomes the system's permanent ceiling. So the algorithm has to be picked **first**, with the most care — every later decision only optimizes inside that ceiling.

This document defends that answer in five parts.

---

## 1. The reviewer's question, in plain English

In the previous semester's presentation a reviewer asked:

> *"Why do we need to choose the best algorithm? Why should choosing the best algorithm be the first priority?"*

This is not a small question. Most engineering teams in industry pick the algorithm last — after the language, the framework, the database, the cloud provider, even after writing half the code. They treat algorithm choice as a tuning step at the end.

This semester we argue the opposite: **algorithm choice is the foundation of the building, not the paint on the wall.** Pick it wrong and no amount of effort spent on the upper floors can save you.

We defend this with two ideas:

1. The **math of scaling** — hardware speed-ups and algorithm speed-ups behave very differently as data grows.
2. The **engineering reality** — algorithms cannot be cheaply swapped in later; they shape every decision downstream.

We then prove this empirically in [02-benchmark-results.md](02-benchmark-results.md) by comparing two of our own architectures side by side.

---

## 2. The math: constant factor vs scaling factor

There are two completely different kinds of speed-up a system can get.

### Hardware = constant-factor speed-up

When you buy a faster CPU or more RAM, the speed-up you get is a **fixed multiplier**. A 2× faster CPU makes every operation run in half the time, no matter how big the dataset is.

| CPU speed | Time to do 1 operation |
|---|---|
| 1× (baseline) | 1 unit of time |
| 2× faster | 0.5 units |
| 10× faster | 0.1 units |
| 100× faster | 0.01 units |

This is a constant. It does not depend on how many operations there are.

**Term defined:**
- **Constant factor** = a fixed multiplier that does not change with input size. Hardware upgrades give constant-factor speed-ups.

### Algorithm = scaling-factor speed-up

The algorithm decides **how many operations** are needed in the first place. The total work is `(number of operations) × (time per operation)`. Hardware shrinks the second part; the algorithm shrinks the first part.

Computer scientists describe an algorithm's growth shape using **Big-O notation**:

| Algorithm class | Big-O | Meaning, in simple English |
|---|---|---|
| Constant | O(1) | Same amount of work regardless of data size |
| Logarithmic | O(log n) | Double the data → add only 1 more step |
| Linear | O(n) | Double the data → double the work |
| Linearithmic | O(n log n) | Double the data → slightly more than double the work |
| Quadratic | O(n²) | Double the data → 4× the work |
| Exponential | O(2ⁿ) | Add one more item → double the work |

**Term defined:**
- **Big-O notation** = a way of describing how the work grows as input size (`n`) grows. It ignores constants and focuses only on the *shape* of the growth.

The shape of the curve is the **scaling factor**. Algorithm choice picks the shape. Hardware only stretches or squashes the curve along the time axis — it cannot bend the curve.

---

## 3. A worked example — text search at 100 vs 100,000 documents

Let's make the abstract math concrete. Suppose we want to answer a single query: *"Which documents contain the word `hello`?"*

We will compare two algorithms.

### Algorithm A — linear scan (the naive way)

For every document, read its text from start to end, and check if the word `hello` appears. If it does, add it to the result.

- Work per query = (number of docs) × (average words per document)
- If average doc length stays fixed, this is **O(n)** — work grows linearly with the number of documents.

### Algorithm B — inverted index (the smart way)

Build a lookup table once, in advance:

```
"hello"   → [doc-3, doc-17, doc-204, ...]
"world"   → [doc-1, doc-3, doc-99, ...]
"pasta"   → [doc-12, doc-44, ...]
```

To answer the query, do one hash-table lookup on the word `hello`.

- Work per query = **O(1)** — one lookup, no matter how many documents exist.

**Term defined:**
- **Inverted index** = a pre-built map from `word → list of documents containing the word`. The standard data structure behind almost every text search engine in the world.

### The numbers

Assume each document has 100 words on average.

| Dataset size | Linear scan ops | Inverted index ops | Speed-up of inverted index |
|---|---|---|---|
| 100 docs | 10,000 | 1 | **10,000×** |
| 1,000 docs | 100,000 | 1 | **100,000×** |
| 10,000 docs | 1,000,000 | 1 | **1,000,000×** |
| 100,000 docs | 10,000,000 | 1 | **10,000,000×** |
| 1,000,000 docs | 100,000,000 | 1 | **100,000,000×** |

Notice how the speed-up **grows** as the data grows. That is the scaling factor at work.

### Now throw hardware at the problem

Suppose linear scan runs on a CPU 100× faster than the one running inverted index. So linear scan gets a huge hardware advantage. Does it close the gap?

| Dataset size | Linear scan (with 100× faster CPU) | Inverted index | Inverted index still faster by |
|---|---|---|---|
| 100 docs | 100 ops | 1 op | 100× |
| 1,000 docs | 1,000 ops | 1 op | 1,000× |
| 100,000 docs | 100,000 ops | 1 op | 100,000× |
| 1,000,000 docs | 1,000,000 ops | 1 op | 1,000,000× |

The 100× faster CPU helps. But the inverted index is **still winning by more and more** as data grows. Hardware shifted the linear curve down, but it could not bend it flat.

### A picture of the two curves

```
work
per
query
   ^
   │                                             ●  linear scan
   │                                       ●
   │                                 ●
   │                          ●
   │                  ●
   │          ●
   │   ●
   │ ●
   ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  inverted index (flat)
   └────────────────────────────────────────────────→  dataset size n
```

The shape of these two curves was decided by the algorithm, not the CPU. Hardware can only move the linear-scan line up or down a little — it cannot turn it into a flat line.

**This is the central insight.** If you pick the linear-scan algorithm, no CPU on Earth will save you when the data gets big enough. The ceiling is set by the slope of your curve.

---

## 4. Why "first"? — the engineering reality

Even if the math is convincing, one might still ask: *"Why pick the algorithm first? Can't we start coding, see how it goes, and swap the algorithm later if needed?"*

In practice, no. Here is why.

### The algorithm shapes everything downstream

The algorithm decides:

1. **The data structures.** Inverted index needs a hash map of word → list. Linear scan just needs raw text files. These are different on disk, different in memory, different to serialize.
2. **The storage layout.** Inverted index wants pre-tokenized, pre-sorted data. Linear scan wants raw documents. Migrating between them touches every byte of stored data.
3. **The API.** With an inverted index, queries are word lookups. With linear scan, queries can be arbitrary regex. The kinds of queries the system *can answer* depend on the algorithm.
4. **The update strategy.** Inverted indexes update incrementally on each insert. Linear scans need no update at all (just write the doc). Switching algorithms means rewriting the write path.
5. **The parallelism story.** Some algorithms shard naturally (hash-by-id); others do not. Whether you can scale out across machines depends on the algorithm.

A late algorithm swap is not a code change — it is a **system rewrite**.

### A real-world analogue

Imagine building a house. The choice of foundation (concrete slab vs wooden stilts vs basement) decides:
- What load-bearing walls are possible
- Where the plumbing runs
- Where doors and windows can go
- Whether you can add a second floor later

Once the foundation is poured, all those decisions are locked in. You can repaint, you can remodel the kitchen, you can re-tile the bathroom — but you cannot turn a slab into a basement without demolishing the house.

**Algorithm = foundation. Hardware = paint and furniture.**

Picking the foundation last makes no sense. That is why algorithm choice has to be **first**, with the most care.

---

## 5. How this principle shaped our 3rd architecture

The 3rd architecture was designed algorithm-first, from the ground up. Every major component is a deliberate algorithmic choice — not an afterthought.

| Decision | The algorithmic claim |
|---|---|
| **Inverted index in each Search Node** | O(1) word lookup beats O(n) scan at every scale |
| **One specialty per node (text / metadata / tags)** | Each node runs the *best* algorithm for its query type, instead of one mediocre algorithm for all types |
| **Hash-by-id sharding in Shard Cluster** | Document storage and retrieval becomes O(1) per shard, parallel across shards |
| **Late hydration (Search Nodes return only `{id, score}`)** | Move only IDs through the pipeline; fetch full documents only for the top-K results at the end. Bounds response size regardless of corpus size |
| **Parallel fan-out from Index Node to Search Nodes** | Compound queries scan all three specialty types simultaneously, not serially |
| **Top-K limit at every step** | The amount of data flowing through the pipeline is bounded by K, not by n |

The previous architecture (the `namenode` branch) was designed differently. It uses an inverted index too, but:
- It is **one single in-memory JSON file**, not sharded
- It returns the **full match list** with no top-K limit, so response size grows with data
- It supports **only text search**, no metadata, no tags, no compound queries
- Updates require a **full MapReduce re-build**, not incremental writes

Both architectures have an inverted index in their text path. But the 3rd architecture made algorithmic choices at **every layer**, not just at the index. That is the difference algorithm-first thinking makes.

This is the hypothesis we will prove in [02-benchmark-results.md](02-benchmark-results.md):

> When the dataset grows from 100 to 100,000 documents, the 3rd architecture's query latency stays nearly flat, while the previous architecture's latency climbs visibly. The reason is not faster hardware — both run on the same machine. The reason is **the algorithmic choices made first**.

---

## 6. Summary

1. **Hardware gives constant-factor speed-ups.** Algorithm gives **scaling-factor speed-ups**.
2. The gap between a bad algorithm and a good algorithm **widens** as data grows. Hardware cannot close that gap.
3. The algorithm shapes the **data structures, storage layout, API, update strategy, and parallelism story** of the whole system. A late algorithm swap is a full rewrite, not a refactor.
4. Therefore the algorithm must be picked **first** — it is the foundation. Everything else is decoration on top.
5. The 3rd architecture in this project was designed algorithm-first at every layer: inverted index, sharding, late hydration, parallel specialty nodes, bounded top-K flow.
6. The next document, [02-benchmark-results.md](02-benchmark-results.md), turns this argument from theory into measured fact.

---

## Glossary of new terms used in this document

- **Algorithm-first design** — making algorithm choice the *first* and *most careful* decision in system design, before any other concern.
- **Big-O notation** — a shorthand for how the work of an algorithm grows with input size. Ignores constants, focuses on shape.
- **Constant factor** — a fixed multiplier that does not depend on input size. Hardware speed-ups are constant factors.
- **Inverted index** — a pre-built lookup from `word → list of documents containing it`. Powers nearly every text search engine.
- **Late hydration** — fetching full documents only at the very last step, for only the top-K results, instead of moving full documents through every pipeline stage.
- **Scaling factor** — how the work of an algorithm grows as the input grows. The shape of its curve. Decided by the algorithm, not the hardware.
- **Sharding** — splitting data into many independent buckets so that each bucket can be processed in parallel and independently.
- **Top-K** — keeping only the K best results (by relevance score) at every step, so the amount of data flowing through the system is bounded.
