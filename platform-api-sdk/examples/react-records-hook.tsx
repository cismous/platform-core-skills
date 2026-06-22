/**
 * React hook for loading records of a dataset with cancel + error branching.
 * Uses the default production singleton — no app-level wiring needed.
 * For localhost / self-hosted: replace `platform` import with your own
 * resource API built via createApiClient (see guides/setup.md layer 3).
 */
import { useEffect, useRef, useState } from "react";
import { platform, PlatformApiError, type PlatformRecord } from "@platform/api-sdk";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; records: PlatformRecord[] }
  | { kind: "error"; message: string; status?: number };

export function useDatasetRecords(datasetId: string | null): State {
  const [state, setState] = useState<State>({ kind: "idle" });
  // lastFetchedRef dedupes StrictMode double-mount; the in-flight result is dropped
  // by comparing ref to the captured fetchId on completion.
  const lastFetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!datasetId) {
      lastFetchedRef.current = null;
      setState({ kind: "idle" });
      return;
    }
    if (lastFetchedRef.current === datasetId) return;
    lastFetchedRef.current = datasetId;
    const fetchId = datasetId;

    setState({ kind: "loading" });

    void (async () => {
      try {
        const { records } = await platform.datasets.listRecords(fetchId);
        if (lastFetchedRef.current !== fetchId) return;
        setState({ kind: "ready", records });
      } catch (e) {
        if (lastFetchedRef.current !== fetchId) return;
        if (e instanceof PlatformApiError) {
          const message =
            e.status === 401
              ? "请先登录"
              : e.status === 403
                ? "无权访问"
                : e.status === 404
                  ? "数据集不存在"
                  : `服务异常 (${e.status})`;
          setState({ kind: "error", message, status: e.status });
        } else {
          setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        }
      }
    })();
  }, [datasetId]);

  return state;
}

/**
 * Usage:
 *
 *   const state = useDatasetRecords(datasetId);
 *   if (state.kind === "loading") return <Spinner />;
 *   if (state.kind === "error") return <Alert>{state.message}</Alert>;
 *   if (state.kind === "ready") return <Table rows={state.records} />;
 *   return null;
 */
