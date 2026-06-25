# Authentication

Two modes, one rule: **never mix them in the same request**.

| Mode           | When                                  | Header             | `credentials` | SDK entry                       |
| -------------- | ------------------------------------- | ------------------ | ------------- | ------------------------------- |
| Session cookie | Browser SPA logged in via Better Auth | (cookie automatic) | `"include"`   | `platform` singleton            |
| API key        | Server-to-server, CLI, headless       | `x-api-key: <key>` | `"omit"`      | `createPlatformWithApiKey(key)` |

## Mode 1: session cookie

The user logs in through `/api/auth/sign-in/*`, Better Auth sets an HttpOnly cookie, and every subsequent platform call rides on it.

```ts
import { platform, auth } from "@platform/api-sdk";

// All resource methods just work; auth is transparent.
const { items } = await platform.datasets.listRecords(datasetId);

// Reading the current session
const session = await auth.getAuthSession(); // null if not logged in
if (session?.user?.id) {
  /* logged in */
}
```

CORS: the platform API must allow the consumer origin (`CORS_ORIGINS` env on the server). Cookies require `Access-Control-Allow-Credentials: true` + a concrete origin, not `*` — handled server-side already.

## Mode 2: API key

For server-to-server, CLI, or any non-browser caller.

```ts
import { createPlatformWithApiKey, PlatformApiError } from "@platform/api-sdk";

const platform = createPlatformWithApiKey(process.env.PLATFORM_API_KEY!);

try {
  const { items } = await platform.datasets.listRecords(datasetId);
  // ...
} catch (e) {
  if (e instanceof PlatformApiError && e.status === 401) {
    // key invalid or revoked
  } else throw e;
}
```

The factory does three things for you:

1. Uses the production endpoints (resilient DDNS + backup)
2. Sets `credentials: "omit"` so no stray browser cookie collides with the key
3. Injects `x-api-key` on every fetch (resource API or raw `fetchJson`)

Returned `platform` is independent — you can hold multiple instances if your service rotates between several keys.

### Multiple keys

```ts
const reader = createPlatformWithApiKey(process.env.READ_KEY!);
const writer = createPlatformWithApiKey(process.env.WRITE_KEY!);

const { items } = await reader.datasets.listRecords(datasetId);
await writer.datasets.createRecord(datasetId, { schemaVersionId: svId, data: items[0]?.data });
```

### Custom endpoints + API key (rare)

`createPlatformWithApiKey` hard-codes production endpoints. If you need API key against localhost or a self-hosted deployment, drop to layer 3:

```ts
import {
  createApiClient,
  createPlatformResourceApi,
  apiKeyAuthHeaders,
  type ApiClient,
} from "@platform/api-sdk";

function withDefaultHeaders(raw: ApiClient, headers: HeadersInit): ApiClient {
  return {
    get baseUrl() {
      return raw.baseUrl;
    },
    fetchJson: (path, init) =>
      raw.fetchJson(path, {
        ...init,
        headers: { ...headers, ...(init?.headers as Record<string, string>) },
      }),
    fetchVoid: (path, init) =>
      raw.fetchVoid(path, {
        ...init,
        headers: { ...headers, ...(init?.headers as Record<string, string>) },
      }),
    destroy: () => raw.destroy(),
  };
}

const raw = createApiClient({ baseUrl: "http://localhost:1005/api/platform", credentials: "omit" });
const client = withDefaultHeaders(raw, apiKeyAuthHeaders(process.env.PLATFORM_API_KEY!));
const platform = createPlatformResourceApi(client);
```

(This is essentially what `createPlatformWithApiKey` does internally.)

## Managing API keys programmatically

`authApiKey` gives list / create / get / update / delete for keys. These admin endpoints **require** a logged-in session (cookie), not another API key:

```ts
import { authApiKey } from "@platform/api-sdk";

const response = await authApiKey.createApiKey({
  name: "ci-bot",
  permissions: { datasets: ["read", "write"] },
});
console.log("Save this — only shown once:", response.key);
console.log("DB record:", response););
```

`authApiKey.getAuthSessionWithApiKey(key)` exchanges a key for a session payload — niche, prefer the header flow.

## Common mistakes

| Symptom                               | Cause                                                                                | Fix                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `401 unauthorized` from API key       | sent both cookie and `x-api-key`                                                     | use `createPlatformWithApiKey` (forces `omit`)                                             |
| `CORS error` on first call            | server `CORS_ORIGINS` missing your origin                                            | add the consumer origin to `CORS_ORIGINS` env in `@platform/api` / `@platform/auth-server` |
| `Random 403 on writes`                | session cookie present but user has no RLS access to that dataset                    | check `app.recordWritePolicy` + dataset RLS — not a client bug                             |
| API key works locally but not in prod | layer-1/2 endpoints are hard-coded to production ingress; localhost won't reach them | use layer 3 for non-production                                                             |
