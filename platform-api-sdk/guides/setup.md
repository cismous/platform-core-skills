# Client setup

Three layers. Pick the lowest one that works.

## Layer 1: default singletons (recommended)

Use when consuming production platform-core from a browser SPA or a Node/Bun service with cookie session.

```ts
import { platform, auth, authApiKey } from "@base/api-sdk";

await platform.datasets.listRecords(datasetId);
const session = await auth.getAuthSession();
const keys = await authApiKey.listApiKeys();
```

- Endpoints are fixed: 4 primary `*.ingress.xxbobo.cn` + 1 backup `ingress-sure.xxbobo.cn`
- Credentials: `"include"` (cookie session)
- Eager, side-effect-free initialization — `import` does not start any timer or network call
- Singletons are process-global; safe to import in multiple modules

## Layer 2: API-key factory (server-to-server)

Use for CLIs, background jobs, webhooks, or any non-browser caller authenticating with `x-api-key`.

```ts
import { createPlatformWithApiKey } from "@base/api-sdk";

const platform = createPlatformWithApiKey(process.env.PLATFORM_API_KEY!);
await platform.datasets.listRecords(datasetId);
```

- Same fixed production endpoints as layer 1
- Credentials forced to `"omit"` so no stray cookie collides with the key
- Each call to `createPlatformWithApiKey` returns an independent client — you can hold multiple keys side-by-side
- Returned `platform` has the same shape as the layer-1 singleton

If you need both keys *and* customized endpoints, drop to layer 3.

## Layer 3: low-level builder

Use for local development (localhost), self-hosted deployments (different domain), or any time you need to control transport details.

### 3a. Simple (single endpoint)

```ts
import {
  createApiClient,
  createPlatformResourceApi,
  buildPlatformApiClientConfig,
} from "@base/api-sdk";

const client = createApiClient(
  buildPlatformApiClientConfig({ baseUrl: "http://localhost:1005" }), // site root only — no /api/platform suffix
);
const platform = createPlatformResourceApi(client);
```

`buildPlatformApiClientConfig` handles prefix concatenation (`/api/platform`) and accepts either an explicit `baseUrl` or env vars (`VITE_PRIMARY_ENDPOINTS` / `VITE_BACKUP_ENDPOINT`).

### 3b. Resilient (DDNS multi-primary + cloud backup)

```ts
import {
  createApiClient,
  createPlatformResourceApi,
  parsePrimaryEndpoints,
  PLATFORM_API_PREFIX,
} from "@base/api-sdk";

const client = createApiClient({
  primaryEndpoints: parsePrimaryEndpoints(
    import.meta.env.VITE_PRIMARY_ENDPOINTS, // "https://api1...,https://api2..." (bare site roots, no /api/platform suffix)
  ),
  backupEndpoint: `${import.meta.env.VITE_BACKUP_ENDPOINT}${PLATFORM_API_PREFIX}`,
  credentials: "include",
});
const platform = createPlatformResourceApi(client);
```

- Each endpoint must already include the prefix
- Probes run on an interval **only after** a primary fails — call `client.destroy()` on shutdown to stop them

`getDefaultPlatformApiClientConfig()` (used internally by layer 1) returns this resilient config with the production endpoints pre-filled — useful if you want to keep production endpoints but override `credentials`.

### Auth-server in layer 3

```ts
import {
  createApiClient,
  createAuthSessionApi,
  createAuthApiKeyApi,
  buildAuthApiClientConfig,
} from "@base/api-sdk";

const authClient = createApiClient(
  buildAuthApiClientConfig({ baseUrl: "http://localhost:1006" }),
);
const auth = createAuthSessionApi(authClient);
const authApiKey = createAuthApiKeyApi(authClient);
```

## Lifecycle

```ts
// app boot — nothing to do for layer 1/2
// shutdown / hot reload (rare)
import { destroyDefaultClients } from "@base/api-sdk";
destroyDefaultClients();
```

For layer 3 you own the `client`; call `client.destroy()` yourself.

## Don't

- ❌ `createApiClient` inside a React component render — do it at module scope or use layer 1
- ❌ Pass `baseUrl: ".../api/platform"` to `buildPlatformApiClientConfig` — give the site root, the helper concatenates the prefix
- ❌ Use layer 1 `platform` with API key — cookie+key mix; use layer 2 instead
- ❌ Try to override headers on resource calls — the resource API has no per-request `init`; build a custom client (layer 2/3) instead
