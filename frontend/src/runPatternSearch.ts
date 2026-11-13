import type { PatternRequest, PatternResult } from "./patternSearch";
export function runPatternSearch(
  request: PatternRequest,
  signal: AbortSignal,
  timeoutMs = 1500,
): Promise<PatternResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Search cancelled.", "AbortError"));
      return;
    }
    const worker = new Worker(
      new URL("./patternSearch.worker.ts", import.meta.url),
      { type: "module" },
    );
    const finish = (result?: PatternResult, error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const cancel = () =>
      finish(undefined, new DOMException("Search cancelled.", "AbortError"));
    const timer = setTimeout(
      () =>
        finish(
          undefined,
          new Error("This search took too long. Refine the expression."),
        ),
      timeoutMs,
    );
    signal.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event) => finish(event.data);
    worker.onerror = () =>
      finish(undefined, new Error("The search worker could not run."));
    worker.postMessage(request);
  });
}
