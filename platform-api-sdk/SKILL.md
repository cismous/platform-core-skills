---
name: platform-api-sdk
description: Calls the platform `/api/platform` and `/api/auth` services through the `@platform/api-sdk` SDK. Provides zero-config default singletons (`platform`, `auth`, `authApiKey`) for production ingress; ships `createPlatformWithApiKey(key)` for server-to-server flows and `createApiClient` + `buildPlatformApiClientConfig` for local dev / self-hosted endpoints. Covers CRUD on datasets — records, fields, schema versions, publishing, migration plans, workflow rules. Triggers when code imports `@platform/api-sdk`, when a project has `"@platform/api-sdk"` in `package.json`, or when a question mentions platform datasets / records / schema versions / `x-api-key` / `PlatformApiError` / `createPlatformResourceApi` / `createPlatformWithApiKey`.
allowed-tools: Bash(bun *), Bash(npm *), Bash(pnpm *)
---

# @platform/api-sdk

A typed JSON client for the platform backend. Three ingress paths:

| Prefix | Mounted by | What it serves |
|---|---|---|
| `/api/platform` | `@platform/api` (Hono + zod-openapi) | apps · datasets · records · fields · schema versions · members · notification channels · workflow rules · user devices |
| `/api/auth` | `@platform/auth-server` (Better Auth) | sessions · organizations · members · API keys |

The SDK is **transport-only** — no caching, no retry, no auth state. Bring your own state container (React context, Zustand, etc).

## When this skill applies

Use this skill when:

- The project's `package.json` lists `"@platform/api-sdk"` as a dependency
- A file imports from `@platform/api-sdk` (root, or any subpath)
- The user asks about platform CRUD, datasets, records, schema versions, fields, publishing, API keys, or session auth in the context of this SDK
- The user pastes `platform.`, `createPlatformWithApiKey`, `PlatformApiError`, `createPlatformResourceApi`, `createApiClient`, `apiKeyAuthHeaders`, or any exported symbol from this package

Do **not** use this skill for unrelated REST/fetch tasks, generic OpenAPI clients, or for building the platform itself (in-tree development of `@platform/api`).

## Install

```fish
bun add @platform/api-sdk       # bun
npm install @platform/api-sdk   # npm
pnpm add @platform/api-sdk      # pnpm
```

Peer requirement: a runtime with global `fetch` and `Headers` (Bun, Node ≥ 18, modern browsers).

---

## Pick your entry point

The SDK ships **three layers**. 99% of consumers want layer 1.

| Layer | Import | When |
|---|---|---|
| **1. Default singleton** | `import { platform } from "@platform/api-sdk"` | Production, browser cookie session, zero config |
| **2. API-key factory** | `import { createPlatformWithApiKey } from "@platform/api-sdk"` | Production, server-to-server / CLI |
| **3. Low-level builder** | `createApiClient` + `buildPlatformApiClientConfig` | Local dev (localhost), self-hosted (different domain), custom transport |

Endpoints in layers 1 & 2 are fixed to production ingress (same constants as `console-web` Dockerfile):

```
https://api.ingress.xxbobo.cn:8443   (primary 1)
https://api1.ingress.xxbobo.cn:8443  (primary 2)
https://api2.ingress.xxbobo.cn:8443  (primary 3)
https://api3.ingress.xxbobo.cn:8443  (primary 4)
https://api.ingress-sure.xxbobo.cn   (backup)
```

The client automatically fails over to backup if all primaries return errors.

---

## 30-second quick start: browser SPA (cookie session)

```ts
import { platform, PlatformApiError } from "@platform/api-sdk";

// CRUD records on a dataset. datasetId resolved out-of-band
// (e.g. listApps → listDatasets, then cached).
const { records } = await platform.datasets.listRecords(datasetId);

const { record } = await platform.datasets.createRecord(datasetId, {
  data: { title: "hello", qty: 3 },
});

await platform.datasets.patchRecord(datasetId, record.id, { data: { qty: 4 } });
await platform.datasets.deleteRecord(datasetId, record.id);

// Errors carry status + bodyText + url.
try {
  await platform.datasets.getRecord(datasetId, "missing");
} catch (e) {
  if (e instanceof PlatformApiError && e.status === 404) {
    // not found
  } else throw e;
}
```

Auth: the default `platform` instance uses `credentials: "include"`, so the Better Auth session cookie (set after login via `/api/auth/sign-in/*`) rides every request.

## 30-second quick start: server-to-server (API key)

```ts
import { createPlatformWithApiKey, PlatformApiError } from "@platform/api-sdk";

const platform = createPlatformWithApiKey(process.env.PLATFORM_API_KEY!);

const { records } = await platform.datasets.listRecords(datasetId);
const { record } = await platform.datasets.createRecord(datasetId, {
  data: { title: "from-server", qty: 1 },
});
```

`createPlatformWithApiKey` does the right thing automatically: production endpoints + `credentials: "omit"` + injects `x-api-key` on every call. The returned `platform` has the same shape as the default singleton.

## 30-second quick start: local dev / self-hosted

```ts
import {
  createApiClient,
  createPlatformResourceApi,
  buildPlatformApiClientConfig,
} from "@platform/api-sdk";

// Local dev pointing at http://localhost:1005
const client = createApiClient(
  buildPlatformApiClientConfig({ baseUrl: "http://localhost:1005" }),
);
const platform = createPlatformResourceApi(client);
```

See [guides/setup.md](./guides/setup.md) for resilient DDNS config and per-env wiring.

---

## Module map

```
@platform/api-sdk
│
├── platform                        # default singleton (cookie session, prod ingress)
├── auth                            # auth-server session API singleton
├── authApiKey                      # API-key management (admin endpoints, requires session)
├── createPlatformWithApiKey(key)   # server-to-server factory
├── destroyDefaultClients()         # stop background probes on shutdown
│
├── createApiClient(config)         # low-level HTTP factory
├── createPlatformResourceApi(c)    # wrap any client with typed /v1/* surface
├── createAuthSessionApi(c)         # same, for /api/auth/*
├── createAuthApiKeyApi(c)          # same, for API-key admin
│
├── buildPlatformApiClientConfig    # build ApiClientConfig from env / explicit baseUrl
├── buildAuthApiClientConfig        # same, for auth-server
├── getDefaultPlatformApiClientConfig  # the config powering `platform`
├── parsePrimaryEndpoints           # parse comma-separated DDNS list
├── PLATFORM_API_PREFIX = "/api/platform"
├── AUTH_API_PREFIX = "/api/auth"
│
├── apiKeyAuthHeaders(key)          # → { "x-api-key": key } (helper for low-level usage)
├── AUTH_API_KEY_HEADER             # "x-api-key"
│
└── PlatformApiError                # thrown on non-2xx
```

The resource API (`platform.orgs / .apps / .datasets / .userDevices`) mirrors the OpenAPI segmentation.

## Guides

| File | When to read |
|---|---|
| [guides/setup.md](./guides/setup.md) | Choosing layer 1/2/3; resilient DDNS config; lifecycle / `destroy()` |
| [guides/auth.md](./guides/auth.md) | Session cookie vs. API key trade-offs; managing keys with `createAuthApiKeyApi` |
| [guides/records-crud.md](./guides/records-crud.md) | `datasets.{list,get,create,patch,delete}Record` — payload shape, common 4xx pitfalls |
| [guides/schema.md](./guides/schema.md) | Schema versions lifecycle (draft → pending → published), field CRUD, diff & publish with migration plan |
| [guides/storage-patterns.md](./guides/storage-patterns.md) | How to model variable-shape data on datasets — single record, metadata + body, time-bucketed, external storage. Read before designing a new dataset. |
| [guides/errors.md](./guides/errors.md) | `PlatformApiError` fields; retry / 401 / 403 / 404 / 422 handling patterns |

## Examples

| File | Stack |
|---|---|
| [examples/node-cli-crud.ts](./examples/node-cli-crud.ts) | Bun / Node — full CRUD round-trip with `createPlatformWithApiKey` |
| [examples/react-records-hook.tsx](./examples/react-records-hook.tsx) | React — `useEffect` consuming default `platform` + `PlatformApiError` handling |
| [examples/ai-chat-conversations.ts](./examples/ai-chat-conversations.ts) | Real-world Pattern 1 case — AI chat conversations stored as one record each with messages in a json field (create / append / list / archive / delete) |

## Critical rules

1. **Prefer the default `platform` import.** Don't build your own `createApiClient` chain unless you actually need a different endpoint (local dev, self-hosted, custom transport).
2. **API key flows go through `createPlatformWithApiKey`.** It enforces `credentials: "omit"` and header injection — don't mix cookie + key by hand.
3. **`PlatformApiError.status` is the canonical signal.** Don't `try { ... } catch { return null }` blindly — at minimum distinguish 401/403 (auth) from 404 (missing) from 5xx (retry-worthy).
4. **Resource methods don't accept per-request `init`.** Auth is configured on the client, not on the call. If you need a different auth/header per call, build a separate client (see `createPlatformWithApiKey` for the canonical pattern).
5. **`destroyDefaultClients()` is rarely needed.** Default clients hold no timers until a primary fails; call only when intentionally tearing down (hot reload, test cleanup).
