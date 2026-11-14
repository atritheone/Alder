import type { PatternRequest, PatternResult } from "./patternSearch";
const idle: { worker: Worker; timer: ReturnType<typeof setTimeout> }[] = [];
function release(worker: Worker) {
  worker.onmessage = null; worker.onerror = null;
  if (idle.length >= 2) { worker.terminate(); return; }
  const entry = {worker, timer: setTimeout(() => {
    const at = idle.indexOf(entry); if (at >= 0) idle.splice(at, 1);
    worker.terminate();
  }, 30000)};
  idle.push(entry);
}
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
    const cached = idle.pop();
    if (cached) clearTimeout(cached.timer);
    const worker = cached?.worker || new Worker(
      new URL("./patternSearch.worker.ts", import.meta.url),
      { type: "module" },
    );
    let settled = false;
    const finish = (result?: PatternResult, error?: Error) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      if (error) worker.terminate(); else release(worker);
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
    try { worker.postMessage(request); }
    catch (error) { finish(undefined, error instanceof Error ? error : new Error(String(error))); }
  });
}
