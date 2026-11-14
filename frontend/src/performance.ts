export function recordPerformance(event: string, started?: number) {
  void window.alder?.performance?.(event, started === undefined ? undefined : performance.now() - started);
}
