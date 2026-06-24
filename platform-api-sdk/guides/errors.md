# Errors

All non-2xx responses (and JSON parse failures) throw `PlatformApiError`. It carries the status, raw body text, and the URL — enough to branch on and to log.

```ts
class PlatformApiError extends Error {
  readonly status: number;     // HTTP status
  readonly bodyText: string;   // raw response body (may be JSON string or plain text)
  readonly url: string;        // full URL that failed
}
```

## Catch pattern

```ts
import { PlatformApiError } from "@platform/api-sdk";

try {
  const record = await platform.datasets.getRecord(datasetId, id);
  return record;
} catch (e) {
  if (e instanceof PlatformApiError) {
    if (e.status === 404) return null;             // not found — caller decides
    if (e.status === 401) { redirectToLogin(); return null; }
    if (e.status === 403) { showPermissionToast(); return null; }
    if (e.status >= 500) { /* retryable */ }
    // Parse server error body when available:
    const body = safeJson(e.bodyText);
    showError(body?.error ?? `HTTP ${e.status}`);
    return null;
  }
  throw e; // network / unexpected
}

function safeJson(text: string): { error?: string } | null {
  try { return JSON.parse(text); } catch { return null; }
}
```

## Status guide

| Status | Meaning | Action |
|---|---|---|
| 400 | bad request shape | check payload — likely a missing field or wrong UUID |
| 401 | no/invalid auth | refresh session / re-acquire API key |
| 403 | RLS or permission denied | check org membership, dataset write policy |
| 404 | resource missing OR not visible under RLS | distinguish by context; UI shows "not found" either way |
| 409 | conflict (e.g. duplicate code, can't submit twice) | re-fetch state, surface to user |
| 422 | validation error (data shape, schema mismatch) | server body usually has details — display it |
| 429 | rate limit (if enabled upstream) | back off |
| 5xx | server error | retry with backoff once; then surface |

## Retry policy

Don't auto-retry by default. The SDK is intentionally retry-free so callers can choose:

```ts
async function withRetry<T>(fn: () => Promise<T>, max = 3): Promise<T> {
  let attempt = 0;
  let lastErr: unknown;
  while (attempt < max) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!(e instanceof PlatformApiError)) throw e; // network/abort — bail
      if (e.status < 500 && e.status !== 429) throw e; // don't retry 4xx
      const wait = Math.min(1000 * 2 ** attempt, 8000);
      await new Promise((r) => setTimeout(r, wait));
      attempt++;
    }
  }
  throw lastErr;
}

const data = await withRetry(() => platform.datasets.listRecords(datasetId));
```

Only retry 5xx and 429. Retrying 4xx wastes round-trips and can mask logic bugs.

## Abort / cancellation

The resource API doesn't accept `AbortSignal` directly (no `init` parameter). For cancellation, drop to the low-level `client.fetchJson(path, { signal })` (layer 3 — see [guides/setup.md](./setup.md)). React `useEffect` cleanups that only need to ignore stale results can use a `cancelled` ref instead:

```tsx
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const { items } = await platform.datasets.listRecords(datasetId);
      if (!cancelled) setRows(items);
    } catch (e) {
      if (!cancelled && e instanceof PlatformApiError) {
        setError(e.status === 404 ? "no data" : `${e.status}`);
      }
    }
  })();
  return () => { cancelled = true; };
}, [datasetId]);
```

If you genuinely need to abort the in-flight network call (e.g. fast user navigation), use `client.fetchJson(path, { signal })` directly.
