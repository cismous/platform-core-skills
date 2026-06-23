# Records CRUD

`platform.datasets.*` exposes all record operations. The dataset is identified by **UUID** (`datasetId`), not by `code` — resolve it once via `platform.orgs.listApps(orgId)` → `platform.apps.listDatasets(appId)` and cache.

## List

```ts
const { items } = await platform.datasets.listRecords(datasetId);
// items: PlatformRecord[]
```

`PlatformRecord` shape:

```ts
type PlatformRecord = {
  id: string;
  datasetId?: string;
  schemaVersionId?: string;
  data: Record<string, unknown>;   // <-- payload by field code
  createdBy?: string | null;
  createdAt?: string;
  updatedBy?: string | null;
  updatedAt?: string;
};
```

The platform does **not** paginate `listRecords` by default — large datasets should be split or filtered upstream (or extend the API).

## Get one

```ts
const { record } = await platform.datasets.getRecord(datasetId, recordId);
```

404 if not found or not visible under RLS (the SDK does not distinguish — both look like 404 to the caller).

## Create

```ts
const { record } = await platform.datasets.createRecord(datasetId, {
  data: {
    title: "First record",
    qty: 3,
    tags: ["alpha", "beta"],
  },
});
```

`data` keys are field codes from the current schema version. Unknown keys → 422.

## Update (patch)

```ts
await platform.datasets.patchRecord(datasetId, recordId, {
  data: { qty: 4 },                     // partial — merges into existing data
});
```

Patch is a **shallow merge** on `data`. To clear a field, pass `null` (subject to that field's `isRequired` constraint).

## Delete

```ts
const { ok, id } = await platform.datasets.deleteRecord(datasetId, recordId);
```

Soft-delete on the server (history retained). Re-creating with the same logical key is allowed — IDs differ.

## Record history (migration snapshots)

When a record's schema version is migrated, the prior shape is snapshotted. Inspect with:

```ts
const { snapshots } = await platform.datasets.listRecordHistory(datasetId, recordId);
// snapshots: RecordSnapshotRow[] (newest first; contains data + schemaVersionId + migrationBatchId)
```

## Form field options (dropdowns / refs)

Option fields (single/multi select, dataset refs) need their option list resolved. The server returns the right shape per field type:

```ts
const opts = await platform.datasets.getFieldFormOptions(
  datasetId,
  schemaVersionId,
  fieldCode,
);
```

Returned `FieldOptionsResponse` is a discriminated union — use the type guards:

```ts
import { isRecordOptionFieldSingle, isRecordOptionFieldMulti } from "@platform/api-sdk";

if (isRecordOptionFieldSingle(opts)) {
  opts.options.forEach((o) => /* { value, label } */);
}
```

## Common 4xx pitfalls

| Status | Likely cause | Fix |
|---|---|---|
| 400 | bad UUID format or malformed JSON | check payload shape |
| 401 | no session cookie & no `x-api-key` | see [guides/auth.md](./auth.md) |
| 403 | RLS rejection (not a member, or write-policy violated) | confirm `app.recordWritePolicy` + dataset RLS |
| 404 | wrong `datasetId` OR record not visible under RLS | resolve dataset via `apps.listDatasets` first |
| 422 | `data` has unknown field codes, type mismatch, or required field missing | diff against current schema with `listFields(datasetId, schemaVersionId)` |

See [guides/errors.md](./errors.md) for the catch pattern.
