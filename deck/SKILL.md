---
name: deck
description: "Use the `deck` CLI to interact with the platform-core API: manage apps, datasets, schema versions, fields, and records. Triggers when the user wants to add/list/update/delete fields, create/query records, verify data, check schema state, or perform any dataset CRUD via CLI."
allowed-tools: Bash(deck *)
---

# deck CLI

`deck` is the platform-core command-line tool for managing applications, datasets, schema versions, fields, and records. It talks to the platform API and is the primary way to perform data operations during development.

## Prerequisites

- Config must exist: `~/.deck/config.yml` (create with `deck config init`)
- Auth must be set: `deck auth login --api-key <key>`
- Active context must point to the right environment: `deck use daily` / `deck use prod`
- App must be resolvable via one of: `--app <code|id>` flag, `$DECK_APP` env var, or `deck.yml` in the working directory

Check current state:
```bash
deck config show        # see all contexts + active one
deck auth status        # verify key is stored and API accepts it
deck auth whoami        # see which user the key resolves to
deck app get            # confirm the resolved app
```

## Command Tree

```
deck
├── init --app <code|id> [--tenant <orgId>] [--force]
├── app
│   ├── list [--tenant-id <orgId>]
│   ├── get
│   └── create --code <code> [--tenant-id <orgId>] [--public-read] [--meta '{}']
├── datasets (alias: ds)
│   ├── list [--page N] [--page-size N]
│   ├── get <dataset-id>
│   ├── create --code <code> [--public-read] [--write-policy creator_own|members_all] [--meta '{}']
│   ├── publish <dataset-id> --schema-version-id <svId> [--migration '{"defaults":{...},"renames":{...}}']
│   ├── schema-versions (alias: sv)
│   │   ├── list <dataset-id>
│   │   ├── create <dataset-id> [--clone-from <svId>] [--version-no N] [--parent-version-id <id>]
│   │   └── submit <dataset-id> <schema-version-id>
│   ├── fields (alias: f)
│   │   ├── list <dataset-id> [--schema-version-id <svId>]
│   │   ├── add <schema-version-id> --code <code> --type <type> [--required] [--ui-type <hint>] [--order N] [--default '<json>'] [--constraints '<json>']
│   │   ├── update <field-id> [--code <new>] [--required] [--ui-type <hint>] [--order N] [--default '<json>'] [--constraints '<json>']
│   │   └── delete <field-id>
│   ├── query <dataset-id> --sql '<SQL>' [--limit N] [--timeout N] [--describe]
│   └── records (alias: r)
│       ├── list <dataset-id> [--page N] [--page-size N]
│       ├── get <dataset-id> <record-id>
│       ├── create <dataset-id> --schema-version-id <svId> --data '{"field":"value"}'
│       ├── patch <dataset-id> <record-id> --data '{"field":"newValue"}'
│       └── delete <dataset-id> <record-id>
├── config
│   ├── init
│   ├── set <key> <value>
│   ├── get <key>
│   ├── show
│   ├── unset <key>
│   ├── list
│   ├── path
│   └── edit
├── use <context>
├── auth
│   ├── login [--api-key <key>] [--no-verify]
│   ├── logout
│   ├── status
│   └── whoami
├── query --datasets "alias=code,..." --sql '<SQL>' [--limit N] [--timeout N] [--describe]
├── upgrade
├── version
└── completion [bash|zsh|fish|powershell]
```

## Global Flags

| Flag | Description |
|------|-------------|
| `--app <code\|id>`, `-a` | Override app (takes precedence over `$DECK_APP` and `deck.yml`) |
| `--context <name>` | Override the active context for this command |
| `--config <path>` | Override config file path |
| `--json` | Output as JSON (for scripting / piping to `jq`) |
| `--no-border` | Render table without box border (kubectl-style) |

## Typical Workflows

### Initialize a project directory

```bash
# Bind this directory to an app (and optionally a tenant)
deck init --app myapp --tenant org_123

# Each directory can have its own deck.yml pointing to a different app
cd ~/projects/app-a && deck init --app app-a --tenant org_aaa
cd ~/projects/app-b && deck init --app app-b --tenant org_bbb

# Overwrite an existing deck.yml
deck init --app new-app --force
```

### Add a field to a dataset

```bash
# 1. Find the dataset
deck datasets list

# 2. Find or create a draft schema version
deck datasets schema-versions list <dataset-id>
# If no draft exists:
deck datasets schema-versions create <dataset-id>

# 3. Add the field to the draft
deck datasets fields add <schema-version-id> --code title --type string --required

# 4. Verify
deck datasets fields list <dataset-id> --schema-version-id <schema-version-id>

# 5. Submit the draft (draft -> pending_publish)
deck datasets schema-versions submit <dataset-id> <schema-version-id>

# 6. Publish (pending_publish -> published)
deck datasets publish <dataset-id> --schema-version-id <schema-version-id>
```

### Verify a field exists

```bash
# List fields on the published schema version (default)
deck datasets fields list <dataset-id>

# Or on a specific draft
deck datasets fields list <dataset-id> --schema-version-id <svId>

# JSON output for scripting
deck datasets fields list <dataset-id> --json | jq '.[] | select(.fieldCode == "title")'
```

### Create and verify a record

```bash
# Find the published schema version id
deck datasets schema-versions list <dataset-id>

# Create a record
deck datasets records create <dataset-id> \
    --schema-version-id <svId> \
    --data '{"title":"Hello","qty":3}'

# Verify it was created
deck datasets records list <dataset-id>

# Get a specific record
deck datasets records get <dataset-id> <record-id>
```

### Patch a record

```bash
deck datasets records patch <dataset-id> <record-id> --data '{"title":"Updated"}'
```

### Query records with SQL

```bash
# See available columns (field names become SQL column names)
deck datasets query <dataset-id> --describe

# Aggregate query — field codes are used as column names directly
deck datasets query <dataset-id> \
    --sql "SELECT status, COUNT(*) AS cnt, SUM(amount) AS total FROM records GROUP BY status ORDER BY total DESC"

# System columns: _id, _created_at, _updated_at, _created_by
deck datasets query <dataset-id> \
    --sql "SELECT _created_at, status, amount FROM records WHERE amount > 100 ORDER BY _created_at DESC LIMIT 10"

# Read SQL from a file
deck datasets query <dataset-id> --sql @analysis.sql

# Control limits and timeout
deck datasets query <dataset-id> \
    --sql "SELECT * FROM records" \
    --limit 5000 \
    --timeout 20

# JSON output for scripting
deck datasets query <dataset-id> \
    --sql "SELECT status, COUNT(*) AS cnt FROM records GROUP BY status" \
    --json
```

Query restrictions (security):
- Only `SELECT` is allowed — write operations (INSERT/UPDATE/DELETE/DROP etc.) are rejected.
- Only the `records` virtual table is accessible — no access to other tables or system catalogs.
- Queries run under a read-only database role (`app_reader`) with RLS enforced.
- Default timeout: 30s (max 60s). Default row limit: 1000 (max 10000).

### Cross-dataset query (app-level)

```bash
# Describe multiple datasets to see available columns
deck query --datasets "order-items,spu" --describe

# JOIN across datasets — use alias=code to declare datasets, then use aliases in SQL
deck query \
    --datasets "oi=order-items,s=spu" \
    --sql "SELECT s.bigCat, SUM(oi.sumDealPrice) AS revenue
           FROM oi JOIN s ON oi.spuCode = s.merchantCode
           GROUP BY s.bigCat ORDER BY revenue DESC"

# Profit analysis
deck query \
    --datasets "oi=order-items,s=spu" \
    --sql "SELECT s.bigCat,
             SUM(oi.sumDealPrice) AS revenue,
             SUM(oi.amount * s.costPrice) AS cost,
             SUM(oi.sumDealPrice - oi.amount * s.costPrice) AS profit
           FROM oi JOIN s ON oi.spuCode = s.merchantCode
           GROUP BY s.bigCat"

# Slow-moving products
deck query \
    --datasets "oi=order-items,s=spu" \
    --sql "SELECT s.merchantCode, s.title
           FROM s LEFT JOIN oi ON oi.spuCode = s.merchantCode
           WHERE oi.spuCode IS NULL"
```

Cross-dataset query notes:
- Uses `--datasets "alias=code,alias=code"` to declare datasets and their SQL aliases.
- Up to 5 datasets per query. All must belong to the same app (resolved via `--app`).
- Same security restrictions as single-dataset query (read-only, RLS, timeout).

### Switch environments

```bash
deck use daily    # daily deployment (shared DB with local dev)
deck use prod     # production
deck use local    # local dev server
```

## Storage Model

Datasets are backed by PostgreSQL. Record data is stored in a JSONB column — each record's field values live in a single `jsonb` object rather than individual relational columns. This means:

- Field types (`string`, `number`, `boolean`, `json`) are application-level constraints, not SQL column types.
- Queries and filters operate on JSONB, not native columns — consider this when evaluating performance for large datasets or complex filtering.
- Adding/removing fields does not require DDL changes; schema evolution is handled at the application layer via schema versions.

## Field Data Types

The `--type` flag for `fields add` accepts: `string`, `number`, `boolean`, `json`.

## Data Input

The `--data` and `--constraints` flags support three input forms:
- Inline JSON: `--data '{"key":"value"}'`
- File: `--data @./payload.json`
- Stdin: `--data @-`

## App Resolution Order

Commands that need an app resolve it in this order:
1. `--app` flag (code or UUID)
2. `$DECK_APP` environment variable
3. `deck.yml` file in working directory or parents (`app:` field)
4. Error if none found

## Tenant Resolution Order

Commands that need a tenant (organization) resolve it in this order:
1. `--tenant-id` flag
2. `deck.yml` file (`tenant:` field)
3. Context config (`deck config set tenant <orgId>`)

## Error Handling

When the server returns 4xx/5xx, deck prints `HTTP <status>: <body>` — the body usually contains a JSON error with a `code` and `message` field explaining what went wrong (e.g., `draft_already_exists`, `empty_fields`, `field_code_conflict`).

## Tips for AI Usage

- Always use `--json` when you need to parse output programmatically or pipe to `jq`.
- To check if a field exists: `deck datasets fields list <ds> --json | jq '.[] | select(.fieldCode == "<code>")'`
- To get the published schema version id: `deck datasets schema-versions list <ds> --json | jq '.[] | select(.status == "published") | .id'`
- To get the draft schema version id: `deck datasets schema-versions list <ds> --json | jq '.[] | select(.status == "draft") | .id'`
- When creating a field, you need the schema-version-id (not dataset-id) as the positional argument.
- A dataset can only have one unpublished (draft) schema version at a time.
- Fields can only be added/updated/deleted on draft schema versions.
- To run analytics on records: `deck datasets query <ds> --sql "SELECT ..." --json` — field codes become column names; only the `records` virtual table is available.
- Use `--describe` to discover available columns before writing a query: `deck datasets query <ds> --describe --json`
- For large result sets, use `--limit` to control output and `LIMIT`/`OFFSET` in SQL for pagination.
- For cross-dataset JOIN queries: `deck query --datasets "a=ds1,b=ds2" --sql "SELECT ... FROM a JOIN b ON ..." --json`
- Use `deck query --datasets "ds1,ds2" --describe` to see columns across multiple datasets before writing a JOIN query.
