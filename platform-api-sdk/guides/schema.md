# Schema versions, fields, publish, migrations

A dataset has many `schema_versions`. At most one is `published` (the "current"); others are `draft` or `pending_publish`. Fields live under a specific schema version.

## Lifecycle

```
draft ──submitSchemaVersion──> pending_publish ──publish──> published
  │                                  │                         │
  ├── createField / updateField      └── publish (migration)   └── superseded by next publish
  └── deleteField                                              │
                                                               └── records auto-migrated via batch
```

## List versions

```ts
const { schemaVersions } = await platform.datasets.listSchemaVersions(datasetId);
// SchemaVersionRow[] — sort/pick by status
const draft = schemaVersions.find((v) => v.status === "draft");
const published = schemaVersions.find((v) => v.status === "published");
```

## Create / clone a version

```ts
// Empty new draft (rare — usually clone the published one)
const { schemaVersion } = await platform.datasets.createSchemaVersion(datasetId, {
  meta: { note: "v2 cleanup" },
});

// Clone all fields from an existing version (typical for "edit current schema")
const { schemaVersion: v2 } = await platform.datasets.createSchemaVersion(datasetId, {
  cloneFromVersionId: published.id,
  meta: { note: "v2 cleanup" },
});
```

## Delete a draft

Only `draft` / `pending_publish` versions can be deleted.

```ts
await platform.datasets.deleteSchemaVersion(datasetId, draftVersionId);
```

## Fields

`fieldCode` 必须符合 `^[a-z][a-z0-9_]{0,62}$` 格式（小写字母开头，仅含小写字母、数字、下划线，最长 63 字符）。服务端会自动转为全小写存储，建议使用 snake_case 命名（如 `order_id`），避免驼峰（`orderId` 会被存为 `orderid`）。

```ts
// List
const { fields } = await platform.datasets.listFields(datasetId, schemaVersionId);
// schemaVersionId is optional — omit to get the published version's fields

// Create (against a specific schema version)
const { field } = await platform.datasets.createField(schemaVersionId, {
  fieldCode: "priority",
  dataType: "int",
  uiType: "select",
  isRequired: false,
  defaultValue: 1,
  fieldOrder: 5,
  constraints: { min: 1, max: 5 },
  meta: { label: "Priority" },
});

// Update (by fieldId — fieldCode/uiType/etc are editable on draft versions)
await platform.datasets.updateField(field.id, { isRequired: true });

// Delete
await platform.datasets.deleteField(field.id);
```

Field edits on a `published` version are rejected — clone to a draft first.

## Submit then publish

```ts
// 1. Lock the draft (no further field edits)
await platform.datasets.submitSchemaVersion(datasetId, draftVersionId);
// status: draft → pending_publish

// 2. Diff against current published — decide what migration plan you need
const diff = await platform.datasets.getSchemaDiff(datasetId, {
  from: publishedVersionId,    // optional; defaults to current published
  to: draftVersionId,
  renames: { old_code: "new_code" }, // optional: tell server how to map renamed fields
});
// diff.requiredWithoutDefault lists fields that MUST have a default in the migration plan

// 3. Publish (kicks off a background migration batch for all existing records)
const { dataset, migrationBatchId } = await platform.datasets.publish(
  datasetId,
  draftVersionId,
  {
    defaults: { priority: 1 },             // value for new required fields
    renames: { old_code: "new_code" },     // same renames as the diff call
  },
);
```

If `migrationBatchId` is null, no existing records needed migration.

## Track migration progress

```ts
// All batches for a dataset
const { batches } = await platform.datasets.listMigrationBatches(datasetId);

// One batch
const { batch } = await platform.datasets.getMigrationBatch(datasetId, migrationBatchId);
// batch.status: "pending" | "running" | "completed" | "failed" | "cancelled"
// batch.processedCount / batch.totalCount / batch.errorSamples
```

For UI: poll `getMigrationBatch` until `status` is terminal (`completed` / `failed` / `cancelled`).

## Patch dataset config

Not schema-related but lives on `datasets`:

```ts
await platform.datasets.patch(datasetId, {
  isPublicRead: true,                       // anonymous read access
  recordWritePolicy: "creator_own",         // override app-level policy; null = inherit
  meta: { displayName: "Orders v2" },
});
```

## Workflow rules (notifications / webhooks)

Each rule fires on record events (create / update / delete) and posts to one or more notification channels:

```ts
const { rule } = await platform.datasets.createWorkflowRule(datasetId, {
  name: "notify-on-new-order",
  trigger: "record.created",
  enabled: true,
  conditionJson: { /* ... */ },
  templateBody: "New order: {{ data.title }}",
  templateContentType: "text/plain",
  channelIds: [channelId],
});

await platform.datasets.patchWorkflowRule(datasetId, rule.id, { enabled: false });
await platform.datasets.deleteWorkflowRule(datasetId, rule.id);
```

Notification channels themselves live under `platform.apps.{listNotificationChannels, createNotificationChannel, deleteNotificationChannel}`.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| 422 on `publish` | required new fields lack a default in the migration plan | use `getSchemaDiff` first, fill `defaults` for everything in `requiredWithoutDefault` |
| 409 on `submitSchemaVersion` | version is already `published` or `pending_publish` | clone a fresh draft |
| Records visible to old schema but missing new fields | publish happened but the migration batch is still `pending`/`running` | poll `getMigrationBatch` |
| Renamed field appears as both old + new in records | forgot `renames` in the publish call | re-publish (or re-run migration) with `renames` supplied |
