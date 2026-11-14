type Entry = {
  event: string;
  ms: number;
  duration?: number;
  operation?: string;
  values?: Record<string, number>;
};
declare global {
  var __alderOperationTimings:
    | { enabled: boolean; events: Entry[]; dropped?: number }
    | undefined;
}
/** Developer opt-in; bounded local numeric telemetry, without manuscript values. */
export function recordOperation(
  event: string,
  started?: number,
  operation?: string,
  values?: Record<string, number>,
) {
  const trace = globalThis.__alderOperationTimings;
  if (!trace?.enabled) return;
  if (trace.events.length === 2048) {
    trace.events.shift();
    trace.dropped = (trace.dropped || 0) + 1;
  }
  trace.events.push({
    event,
    ms: performance.now(),
    ...(started === undefined ? {} : { duration: performance.now() - started }),
    ...(operation ? { operation } : {}),
    ...(values ? { values } : {}),
  });
}
