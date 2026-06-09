# Schema Registry — API Documentation

The Schema Registry is the **rule book** of the distributed search engine. It stores the field mappings for every domain (ecommerce, social, logs, etc.) so other nodes (Gateway, Index Node, Search Nodes) know how to handle each domain's data.

**Service port:** 5000 (default, can be changed via `PORT` env var)
**Base URL inside Docker:** `http://schema-registry:5000`

---

## Quick Endpoint List

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service health check |
| POST | `/schema/:domain` | Register a new schema for a domain |
| GET | `/schema/:domain` | Get the schema for one domain |
| GET | `/schemas` | List all registered domains |
| PUT | `/schema/:domain` | Update an existing schema |
| DELETE | `/schema/:domain` | Remove a domain's schema (future) |

---

## 1. Health Check

### What
Simple endpoint that returns service status. Used by Docker, monitoring, and other nodes to confirm Schema Registry is alive.

### Why
Every service in the system needs a way to say "I am alive." Without this, Docker health checks fail and the system cannot tell when this node is down.

### How

**Request**
```
GET /health
```

**Response**
```json
{
  "status": "ok",
  "service": "schema-registry"
}
```

**Status code:** `200 OK`

---

## 2. Register a Schema

### What
Saves a new domain's field mapping. The domain is **created automatically** when you upload its schema (one-step design).

### Why
This is the **core feature** of the Schema Registry. Without this, no domain can use the engine. Every other node (Gateway, Index Node, Search Nodes) reads schemas from here to know how to process each domain's data.

### How

**Request**
```
POST /schema/ecommerce
Content-Type: application/json

{
  "text":     ["title", "description"],
  "metadata": ["price", "brand", "category"],
  "tags":     ["tags"]
}
```

**Response (success)**
```json
{
  "domain": "ecommerce",
  "schema": {
    "text":     ["title", "description"],
    "metadata": ["price", "brand", "category"],
    "tags":     ["tags"]
  }
}
```

**Status code:** `201 Created`

### Why URL Param Instead of Body?

We put the domain name in the URL (`/schema/ecommerce`) instead of inside the body for these reasons:

- Standard REST style — URL identifies the resource
- Future GET, PUT, DELETE all use the same URL pattern
- Matches industry tools (Elasticsearch, MongoDB Atlas)
- Self-documenting in logs

### Domain Name Rules

The domain name in the URL must be **URL-safe**:
- Lowercase letters (a-z)
- Numbers (0-9)
- Hyphens (-)
- Underscores (_)

Examples of valid names: `ecommerce`, `social-posts`, `log_search`, `media2`
Invalid: `My Domain` (space), `email@domain` (special char)

### Single Domain vs Multiple Domains

The same endpoint works for both cases:
- **Single-domain app:** call POST `/schema/ecommerce` once. Done.
- **Multi-domain app:** call POST many times, one per domain.

The Schema Registry does not care how many domains exist.

---

## 3. Get a Schema

### What
Returns the saved schema for one domain.

### Why
Other nodes (Gateway, Index Node, Search Nodes) call this when they need to know how to handle a domain's data. Example: Index Node receives a new product and asks "what are the text fields for ecommerce?"

### How

**Request**
```
GET /schema/ecommerce
```

**Response (success)**
```json
{
  "domain": "ecommerce",
  "schema": {
    "text":     ["title", "description"],
    "metadata": ["price", "brand", "category"],
    "tags":     ["tags"]
  }
}
```

**Status code:** `200 OK`

**Response (not found)**
```json
{
  "error": "Schema not found for domain: ecommerce"
}
```

**Status code:** `404 Not Found`

---

## 4. List All Domains

### What
Returns a list of every registered domain.

### Why
Useful for:
- Admin dashboards — see what domains exist
- Discovery — apps can list available domains
- Debugging — confirm a domain was registered

### How

**Request**
```
GET /schemas
```

**Response**
```json
{
  "count": 3,
  "domains": ["ecommerce", "social", "logs"]
}
```

**Status code:** `200 OK`

**If empty:**
```json
{
  "count": 0,
  "domains": []
}
```

---

## 5. Update a Schema

### What
Replaces an existing domain's schema with a new one. Domain must already exist.

### Why
Domains change. A shop might add a new field `discount_price`. A social app might add `mentions`. Without update, you would have to delete and re-create — losing all indexed data.

### How

**Request**
```
PUT /schema/ecommerce
Content-Type: application/json

{
  "text":     ["title", "description"],
  "metadata": ["price", "brand", "category", "discount_price"],
  "tags":     ["tags"]
}
```

**Response (success)**
```json
{
  "domain": "ecommerce",
  "schema": { ... updated ... }
}
```

**Status code:** `200 OK`

**Response (domain not found)**
```json
{
  "error": "Schema not found for domain: ecommerce"
}
```

**Status code:** `404 Not Found`

### POST vs PUT — What's the Difference?

| Method | Use When |
|---|---|
| `POST /schema/:domain` | **Creating** a new domain for the first time |
| `PUT /schema/:domain` | **Updating** an existing domain's schema |

If you POST when the domain already exists, you may get an error (or overwrite — design choice).
If you PUT when the domain does not exist, you get `404`.

---

## 6. Delete a Schema (Future)

### What
Removes a domain and its schema from the registry.

### Why
Useful when a domain is retired or was created by mistake.

### How

**Request**
```
DELETE /schema/ecommerce
```

**Response (success)**
```json
{
  "domain": "ecommerce",
  "deleted": true
}
```

**Status code:** `200 OK`

**Note:** Deleting from Schema Registry does NOT delete the indexed data in Search Nodes. That is a separate operation.

---

## Schema Structure (What Goes in the Body)

Every schema has 3 main parts. These match the 3 specialty Search Nodes.

```json
{
  "text":     ["field1", "field2"],
  "metadata": ["field3", "field4"],
  "tags":     ["field5"]
}
```

| Section | What goes here | Example fields |
|---|---|---|
| **text** | Long free-text fields | `title`, `description`, `content`, `message`, `post_body` |
| **metadata** | Structured values (numbers, fixed strings, dates) | `price`, `brand`, `author`, `created_at`, `category` |
| **tags** | Short labels, sets, hashtags | `tags`, `hashtags`, `labels`, `keywords` |

### Validation Rules

A valid schema must:
- Be a JSON object
- Have at least one of: `text`, `metadata`, or `tags`
- Each section value must be an array of strings
- Field names cannot be empty

If validation fails, the registry returns `400 Bad Request`.

---

## Storage & Persistence

- Schemas are kept in memory during runtime (fast lookup).
- A backup copy is saved to disk at `/data/schemas.json` after every change.
- On service restart, all schemas are loaded from disk automatically.
- No data is lost between restarts.

---

## Example: Full Lifecycle

```bash
# 1. Register a new shop's domain
curl -X POST http://schema-registry:5000/schema/myshop \
  -H "Content-Type: application/json" \
  -d '{ "text": ["name"], "metadata": ["price"], "tags": ["category"] }'

# 2. List all domains
curl http://schema-registry:5000/schemas

# 3. Get the shop's schema
curl http://schema-registry:5000/schema/myshop

# 4. Update with new field
curl -X PUT http://schema-registry:5000/schema/myshop \
  -H "Content-Type: application/json" \
  -d '{ "text": ["name", "description"], "metadata": ["price"], "tags": ["category"] }'

# 5. (Future) Remove
curl -X DELETE http://schema-registry:5000/schema/myshop
```
