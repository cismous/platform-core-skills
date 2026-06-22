# Storage patterns

How to model your data on top of platform datasets when shape and size vary. Reference cases:

- Conversational AI (1~N rounds, KB~tens of KB per conversation) → **Pattern 1**, see [examples/ai-chat-conversations.ts](../examples/ai-chat-conversations.ts)
- Append-only event logs → **Pattern 3**
- Long-form documents / RAG context → **Pattern 2** or **Pattern 4**

## Platform constraints that drive selection

Before picking a model, internalize three current limits of `@platform/api`:

| Limit | Implication |
|---|---|
| `listRecords` has **no `where` filter** | Cannot fetch "records where field X == Y" efficiently |
| `listRecords` has **no pagination** | Whole table loads in one shot |
| `listRecords` has **no field projection** | All `data` keys returned, including large json blobs |

If your data model needs server-side filtering or pagination, you must either (a) split into smaller datasets or (b) extend `@platform/api` — not within this skill's scope.

---

## Pattern 1 — Single record = single entity (default)

**Use when:** one logical unit (a conversation, a document, an order with nested line items, a report) is < ~100 KB and you typically read/write it whole.

**Shape:**

```
dataset:  <entity-plural>
  schema:
    <a few flat metadata fields for listing>
    <one "body" field of dataType: "json"> ← the variable part
```

**Why it works:** PG `jsonb` handles tens-of-KB rows transparently (TOAST kicks in past ~2 KB but is invisible to the API). One `getRecord` returns the complete entity, one `patchRecord` updates it. List-views render from the flat metadata fields and don't need to parse the json blob.

**Schema cheat sheet:**

| Concern | Field type |
|---|---|
| Display name in lists | `text` / `text_single` |
| Long preview snippet | `long_text` / `textarea` |
| Counts (messages, attachments) | `int` / `number_input` |
| Sort key (last activity) | `datetime` / `datetime_picker` |
| Archive / soft state | `boolean` / `switch` |
| The variable payload | `json` / `json_editor` |
| Enum-like tags | `text` + index in app code (no server enum constraint) |

**Reference implementation:** [examples/ai-chat-conversations.ts](../examples/ai-chat-conversations.ts).

**Anti-pattern to avoid:** "one record per nested item" (e.g. one record per chat message, one record per line item). Without a server-side `where` filter, fetching "all messages of conversation X" devolves into a full-table scan client-side. **Don't do this** unless you've added query support to `@platform/api` first.

**When to grow out of it:** any of —

- Total list payload exceeds a few MB (typically: > 500 entities × tens of KB)
- A single entity grows past ~100 KB consistently
- You start needing to fetch only the metadata and skip the json body

→ then go to Pattern 2.

---

## Pattern 2 — Metadata + body across two datasets

**Use when:** Pattern 1 list payload is too heavy, but per-entity reads are still atomic.

**Shape:**

```
dataset:  <entity-plural>           ← always loaded for the list
  schema:
    title, model, lastActivityAt, count, preview, archived, ...
    bodyRecordId (text)             ← reference to a row in the bodies dataset

dataset:  <entity-plural>-bodies    ← loaded only when an entity is opened
  schema:
    body (json)                     ← the heavy payload (messages, content blocks, ...)
```

The relation is by record ID. Use the bodies record's own UUID as `bodyRecordId`, or — simpler — use the **same UUID** for the metadata row and its body row (call `createRecord` on metadata first, then `createRecord` on bodies passing the same id via a custom field if your fork allows; otherwise store the body's id back on metadata via `patchRecord`).

**Trade-offs:**

- ✅ List endpoint is small and fast
- ✅ Open-one is two requests but both targeted by ID (`getRecord` is O(1))
- ❌ Writes touch two datasets — wrap in app-level logic; platform has no transactions across datasets
- ❌ Consistency window: metadata and body can diverge if a write fails mid-flight. Always patch body first, then metadata (so metadata's `count` / `lastActivityAt` only advances when body actually persisted)

---

## Pattern 3 — Time-bucketed datasets (append-only logs)

**Use when:** records keep accumulating and are mostly read by recency. Examples: audit logs, AI inference traces, billing events.

**Shape:**

```
dataset:  events-2026q1   ← active for ~3 months, then frozen
dataset:  events-2026q2
dataset:  events-2026q3
...
```

App code routes writes to the current bucket and reads by scanning recent buckets in order. Old buckets become effectively read-only and can be marked `isPublicRead` or moved to a colder backend.

**Trade-offs:**

- ✅ Each dataset stays bounded — list payload predictable
- ✅ Schema can evolve per bucket (newer buckets get new fields without migrating history)
- ❌ App must know which buckets to query for a date range
- ❌ Cross-bucket aggregates require client-side merge

**Bucket sizing rule of thumb:** target ≤ 10k records per bucket. Pick monthly / quarterly / yearly based on write rate.

---

## Pattern 4 — External object storage + dataset metadata

**Use when:** payload exceeds ~1 MB per entity, or contains binary (PDFs, embeddings, full RAG context).

**Shape:**

```
dataset:  documents
  schema:
    title, kind, sizeBytes, contentType, sha256, uploadedAt
    storageKey (text)   ← s3://bucket/path or minio key
```

The `data` field in the dataset record carries only the **pointer + metadata**. The bytes live in S3 / MinIO / R2 / wherever — out of scope of `@platform/api-sdk`.

**Trade-offs:**

- ✅ Unlimited body size, native CDN / streaming
- ✅ Cheap dataset list — pure metadata
- ❌ Two-system orchestration (signed URLs, lifecycle policies, cleanup)
- ❌ Two-system auth (platform RLS on metadata, S3 IAM on bytes — keep them aligned)

Most apps never need this until their largest "entity" reliably exceeds 1 MB.

---

## Pattern selection chart

```
            single entity        list cardinality        recommended
            payload size         (# of entities)         pattern
─────────────────────────────────────────────────────────────────────
            < 100 KB             < 500                   1 (single record)
            < 100 KB             500 – 5 000             1 + Pattern 3 buckets
            < 100 KB             > 5 000                 2 or 3
            100 KB – 1 MB        any                     2
            > 1 MB               any                     4
            append-only          any                     3 (time buckets)
```

---

## Schema evolution

**Adding an optional field:** straight ahead. New `draft` version → `createField(..., isRequired: false)` → submit → publish. Existing records aren't migrated — `data[newField]` is `undefined` until you write it.

**Adding a required field:** the `publish` call requires a default in the migration plan for every existing record. See [guides/schema.md](./schema.md) §"Submit then publish".

**Renaming a field:** clone schema, `updateField` to rename on the draft, `publish` with `migration.renames = { oldCode: newCode }`. Existing records get their `data` keys rewritten by the migration batch.

**Splitting one Pattern-1 dataset into a Pattern-2 pair:** there is no SDK helper for this — write a one-off script:

1. Create the new `*-bodies` dataset + schema
2. Iterate `listRecords` on the original, for each: `createRecord` on bodies, `patchRecord` on the original to set `bodyRecordId` and clear the heavy json field
3. Once verified, run a schema migration on the original to drop the heavy field

Schedule the migration during low traffic; the platform has no read-your-writes guarantee while a publish migration batch is in flight (see [guides/schema.md](./schema.md) §"Track migration progress").

---

## Field type quick reference

Supported `dataType` values (from `@platform/db/field-ui-types`):

```
text · string · long_text          ← strings (long_text uses textarea by default)
number · integer · int · float · decimal
boolean
date · datetime · time · date_range
json                                ← the escape hatch for any structured payload
url · email · phone · file · color
```

Each `dataType` has compatible `uiType` values; pass a mismatched pair and the server returns 422 `field_ui_type_datatype_mismatch`. If unsure, omit `uiType` — the server picks a sensible default.

Conventions worth following:

- **Display label** of an entity → `text` (avoid `long_text`; lists truncate anyway)
- **Free-form body** → `json` (typed in app code via `as MyType` cast on `record.data[field]`)
- **Sort key for lists** → `datetime`, always ISO 8601 strings
- **Soft state** (archive, hidden, draft) → `boolean`, default `false`

---

## TL;DR

- Start with Pattern 1. It covers > 80% of use cases including AI chat.
- Reach for Pattern 2 only when list payloads visibly bloat.
- Pattern 3 is for genuinely append-only workloads.
- Pattern 4 is for ≥ MB-scale or binary content.
- **Never** model "one record per nested item" — server-side `where` doesn't exist yet.
