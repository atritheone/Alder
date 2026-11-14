/** Bounded ownership of read-only requests. Durable mutations never enter here. */
export class RequestCancellation {
  private requests = new Map<string, AbortController>();
  begin(id: string, method: string, path: string, body: any) {
    if (
      typeof id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(id) ||
      this.requests.has(id)
    )
      throw Error("Invalid request identity.");
    if (
      method !== "GET" &&
      !(
        method === "POST" &&
        /^\/api\/projects\/[^/?#]+\/export$/.test(path) &&
        body?.format === "pdf"
      )
    )
      throw Error("This operation cannot be transport-cancelled.");
    if (this.requests.size >= 64) throw Error("Too many pending requests.");
    const controller = new AbortController();
    this.requests.set(id, controller);
    return {
      signal: controller.signal,
      finish: () => this.requests.delete(id),
    };
  }
  cancel(id: string) {
    this.requests.get(id)?.abort();
  }
  dispose() {
    for (const controller of this.requests.values()) controller.abort();
  }
}
