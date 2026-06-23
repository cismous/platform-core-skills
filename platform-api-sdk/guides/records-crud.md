# Records CRUD

`platform.datasets.*` exposes all record operations. The dataset is identified by **UUID** (`datasetId`), not by `code` — resolve it once via `platform.orgs.listApps(orgId)` → `platform.apps.listDatasets(appId)` and cache.

## List

```ts
const { items } = await platform.datasets.listRecords(datasetId);
// items: PlatformRecord[]
```

### 泛型类型化 data 字段

业务知道自己的字段结构时，可通过泛型让 `data` 获得完整类型推导：

```ts
interface OrderData {
  title: string;
  qty: number;
  status: "pending" | "done";
}

const { items } = await platform.datasets.listRecords<OrderData>(datasetId);
items[0].data.title;  // ✅ string
items[0].data.qty;    // ✅ number
```

不传泛型时 `data` 默认为 `Record<string, unknown>`，和之前完全兼容。

`PlatformRecord` shape:

```ts
type PlatformRecord<T = Record<string, unknown>> = {
  id: string;
  datasetId?: string;
  schemaVersionId?: string;
  data: T;                            // <-- 泛型化，默认 Record<string, unknown>
  createdBy?: string | null;
  createdAt?: string;
  updatedBy?: string | null;
  updatedAt?: string;
};
```

The platform **does** paginate `listRecords` — pass `{ page, pageSize }` and receive `{ items, pagination }`.

## Get one

```ts
const record = await platform.datasets.getRecord(datasetId, recordId);
// 泛型：getRecord<OrderData>(datasetId, recordId) → record.data 为 OrderData
```

404 if not found or not visible under RLS (the SDK does not distinguish — both look like 404 to the caller).

## Create

```ts
const record = await platform.datasets.createRecord(datasetId, {
  schemaVersionId: svId,
  data: {
    title: "First record",
    qty: 3,
    tags: ["alpha", "beta"],
  },
});
```

`data` 的 key 必须匹配当前 schema 版本的 fieldCode。未知 key → 422。

泛型用法：`createRecord<OrderData>(datasetId, { schemaVersionId, data })` → 传参时 `data` 字段受约束。

## Update (patch)

```ts
await platform.datasets.patchRecord(datasetId, recordId, {
  data: { qty: 4 },                     // partial — merges into existing data
});
```

Patch 是 **shallow merge**。清空字段传 `null`（受 `isRequired` 约束）。

泛型用法：`patchRecord<OrderData>(datasetId, recordId, { data: { qty: 4 } })` → `data` 字段受 `Partial<OrderData>` 约束。

## Delete

```ts
const { ok, id } = await platform.datasets.deleteRecord(datasetId, recordId);
```

Soft-delete on the server (history retained). Re-creating with the same logical key is allowed — IDs differ.

## Record history (migration snapshots)

When a record's schema version is migrated, the prior shape is snapshotted. Inspect with:

```ts
const snapshots = await platform.datasets.listRecordHistory(datasetId, recordId);
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

Returned `FieldOptionsResponse` contains `sourceKind` and `options`:

```ts
const opts = await platform.datasets.getFieldFormOptions(
  datasetId,
  schemaVersionId,
  fieldCode,
);
// opts.sourceKind: "static" | "dataset_ref"
// opts.options: { value: string; label: string; disabled?: boolean }[]
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
