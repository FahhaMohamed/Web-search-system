# Specialty Node API

The Specialty Node is the **routing advisor** of the search engine. Given a query, it tells the Gateway which specialty nodes (Text / Metadata / Tags) to fan out to. This avoids hitting nodes that have nothing relevant to the query, saving CPU and network.

**Base URL (in Docker):** `http://specialty-node:6000`
**Base URL (local dev):** `http://localhost:6000`

---

## GET /health

### What
Returns the health status of the Specialty Node service.

### Why
Used by Docker, monitoring tools, and the Gateway to confirm the service is alive and ready to answer routing requests.

### How
```http
GET /health
```

### Response — 200 OK
```json
{
  "status": "ok",
  "service": "specialty-node"
}
```

---

## POST /route

### What
Given a domain name and a search query, returns the list of specialty nodes that the Gateway should query.

### Why
A search query like `"red shoes price<50 #summer"` contains three different kinds of information:
- `"red shoes"` → full-text search → **Text Node**
- `"price<50"` → numeric filter → **Metadata Node**
- `"#summer"` → tag match → **Tags Node**

Without Specialty Node, the Gateway would broadcast every query to all 3 nodes. With it, Gateway only calls the nodes that matter. This is the **vertical partitioning advisor**.

### How
```http
POST /route
Content-Type: application/json

{
  "domain": "ecommerce",
  "query": "red shoes"
}
```

**Body fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `domain` | string | yes | The registered domain name (must exist in Schema Registry). |
| `query` | string | yes | The raw search query from the user. |

### Response — 200 OK
```json
{
  "domain": "ecommerce",
  "query": "red shoes",
  "nodes": [
    { "name": "text", "confidence": 0.7 },
    { "name": "tags", "confidence": 0.4 }
  ]
}
```

**Response fields:**
| Field | Type | Description |
|-------|------|-------------|
| `domain` | string | Echoed back. |
| `query` | string | Echoed back. |
| `nodes` | object[] | Specialty nodes to query, **sorted by `confidence` descending**. Each entry has `name` (text/metadata/tags) and `confidence` (0.0–1.0). |

**Using confidence:**
- Gateway can drop nodes below a threshold (e.g. `< 0.3`) to save fan-out calls.
- Merge & Rank can multiply each result's score by its node's confidence.
- Sections that don't appear in `nodes` should not be queried at all.

### Errors

| Status | Cause |
|--------|-------|
| 400 | `domain` missing in body. |
| 400 | `query` missing in body. |

```json
{ "error": "domain is required" }
```

```json
{ "error": "query is required" }
```

---

## Routing Logic — Layer 1 (domain-agnostic)

Specialty Node looks at each token in the query and classifies it:

| Token type | Detection | Triggers |
|------------|-----------|----------|
| Hashtag | starts with `#` | `tags` |
| Operator | contains `<`, `>`, `=`, `:` | `metadata` |
| Digit | contains any digit (`500`, `2020`, `100-500`, `$50`) | `metadata` |
| Comparison word | `under, over, below, above, less, more, than, around, about, approximately, near, roughly, nearly, between, max, maximum, min, minimum` | `metadata` |
| Stop word | `a, an, the, and, or, but, of, in, on, at, for, with, by, to, from, as, is, are, was, were, be, been, being, this, that, these, those` | (ignored) |
| Anything else (plain word) | — | `text` + `tags` (ambiguous — could be either) |

**Why plain words trigger both text and tags:** A word like `"red"` could appear in a product description (text) OR be a tag value. Without knowing the data, we must check both.

**Why `#`:** explicit narrowing signal — user is saying "I know this is a tag".

**Why stop words ignored:** they're grammar glue (`"between 100 and 500"` — the `and` shouldn't trigger text search).

### Examples (work for any domain)

Shown as `name@confidence` for brevity.

| Query | Nodes |
|-------|-------|
| `red shoes` | `text@0.7, tags@0.4` |
| `#summer` | `tags@1.0` |
| `price<500` | `metadata@1.0` |
| `red shoes under 500` | `metadata@0.9, text@0.7, tags@0.4` |
| `red shoes 500` | `text@0.7, metadata@0.7, tags@0.4` |
| `between 100 and 500` | `metadata@0.9` |
| `red and white shoes` | `text@0.7, tags@0.4` |
| `level:ERROR` | `metadata@1.0` |
| `#summer under 500` | `tags@1.0, metadata@0.9` |
| ` ` (empty) | `text@0.3` (fallback) |

### What's NOT in Layer 1

- **Domain field names** (`price`, `brand`, `level`, `service`, etc.) are not hardcoded. They come from the **Schema Registry** in Layer 2 (next step). This keeps Specialty Node domain-agnostic.
- **Synonyms** (e.g. `cheap → price`) are not handled. Phase 2 may add a synonyms section in schemas.
- **Multi-language** is not supported. Layer 1 is English-only.

---

## Routing Logic — Layer 2 (schema-aware refinement)

Before routing, Specialty Node calls Schema Registry:

```
GET http://schema-registry:5000/schema/:domain
```

The returned schema looks like:
```json
{ "text": ["title","description"], "metadata": ["price","brand"], "tags": ["color"] }
```

This schema **refines** Layer 1 routing:

### Refinement rules

1. **Unknown domain → 404.** No schema means we cannot route safely.

2. **Sections that don't exist are skipped.** If schema has no `tags` array, no query token (including `#hashtag`) will route to tags.

3. **Operator field is looked up in schema.** For a token like `field:value`, `field<value`, etc., the field name is resolved to its section:
   - `color:red` on ecommerce → schema says `color` is in `tags` → routes to `[tags]`
   - `price<500` on ecommerce → schema says `price` is in `metadata` → routes to `[metadata]`
   - `title:hello` on ecommerce → schema says `title` is in `text` → routes to `[text]`

4. **Unknown field with operator → 400 error.** If `xyz:foo` is used and `xyz` is not in any section of the schema, returns `400` with `error: "Unknown field: xyz"`.

5. **Plain word matching a field name** triggers that section. e.g. on ecommerce (`brand` in metadata):
   - `brand nike` → metadata is triggered (because `brand` is recognized as a field name)
   - `shoes color` → tags is triggered (because `color` is a tag field)

### Schema-aware examples

Given:
```json
{
  "ecommerce": { "text": ["title"], "metadata": ["price","brand"], "tags": ["color"] },
  "logs":      { "text": ["message"], "metadata": ["timestamp","level","service"] }
}
```

| Domain | Query | Nodes | Reason |
|--------|-------|-------|--------|
| ecommerce | `color:red` | `tags@1.0` | `color` resolves to tags via schema |
| ecommerce | `price<500` | `metadata@1.0` | `price` resolves to metadata |
| ecommerce | `title:hello` | `text@1.0` | `title` resolves to text |
| ecommerce | `brand nike` | `metadata@0.9, text@0.7, tags@0.4` | `brand` matches metadata field |
| ecommerce | `xyz:foo` | `400 error` | `xyz` not in any section |
| logs | `error connection` | `text@0.7` | No `tags` in schema |
| logs | `#error` | `text@0.3` | No `tags` in schema; `#` ignored, fallback |
| logs | `level:ERROR` | `metadata@1.0` | `level` resolves to metadata |
| unknown | (anything) | `404 error` | Domain not registered |

### Error responses (Layer 2)

| Status | Cause | Body |
|--------|-------|------|
| 400 | Operator field not in schema | `{ "error": "Unknown field: xyz" }` |
| 404 | Domain not registered | `{ "error": "Domain not found: <domain>" }` |

> **Status:** Layer 1 + Layer 2 implemented. Next: confidence scores per node.

---

## Future endpoints (planned)

- `POST /route` will return **confidence scores** per node, e.g. `[{ "node": "text", "confidence": 0.8 }, ...]`, so Gateway can weight results during merge & rank.
- Specialty Node will fetch the domain schema from the Schema Registry (`GET http://schema-registry:5000/schema/:domain`) to validate that filter fields actually exist in the domain.
