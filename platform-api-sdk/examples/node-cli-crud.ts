#!/usr/bin/env bun
/**
 * Full CRUD round-trip on a dataset using an API key.
 * Endpoints are fixed to production ingress (see SKILL.md). For localhost / self-hosted,
 * see guides/setup.md layer 3.
 *
 * Run with:
 *
 *   PLATFORM_API_KEY=... \
 *   DATASET_ID=<uuid> \
 *   bun examples/node-cli-crud.ts
 */
import { createPlatformWithApiKey, PlatformApiError } from "@platform/api-sdk";

function envOrThrow(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) {
    console.error(`Missing env: ${key}`);
    process.exit(1);
  }
  return v;
}

const API_KEY = envOrThrow("PLATFORM_API_KEY");
const DATASET_ID = envOrThrow("DATASET_ID");

async function main() {
  const platform = createPlatformWithApiKey(API_KEY);

  try {
    // 1. Pick a schema version (created out-of-band via the console)
    const { schemaVersions } = await platform.datasets.listSchemaVersions(DATASET_ID);
    const target = schemaVersions.find((v) => v.status === "published") ?? schemaVersions[0];
    if (!target) throw new Error("dataset has no schema version");
    console.log(`Using schemaVersionId=${target.id} (status=${target.status})`);

    // 2. List existing
    const before = await platform.datasets.listRecords(DATASET_ID);
    console.log(`existing records: ${before.records.length}`);

    // 3. Create
    const { record } = await platform.datasets.createRecord(DATASET_ID, {
      schemaVersionId: target.id,
      data: { title: "from-cli", createdBy: "node-example", qty: 1 },
    });
    console.log(`created: ${record.id}`);

    // 4. Patch
    const patched = await platform.datasets.patchRecord(DATASET_ID, record.id, {
      data: { qty: 99 },
    });
    console.log(`patched qty -> ${(patched.record.data as Record<string, unknown>).qty}`);

    // 5. Get
    const fetched = await platform.datasets.getRecord(DATASET_ID, record.id);
    console.log(`fetched: ${JSON.stringify(fetched.record.data)}`);

    // 6. Delete
    const del = await platform.datasets.deleteRecord(DATASET_ID, record.id);
    console.log(`deleted: ok=${del.ok} id=${del.id}`);
  } catch (e) {
    if (e instanceof PlatformApiError) {
      console.error(`API ${e.status} at ${e.url}: ${e.bodyText}`);
      process.exit(2);
    }
    throw e;
  }
}

void main();
