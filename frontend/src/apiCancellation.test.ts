import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { RequestCancellation } from "../../electron/requestCancellation";
afterEach(() => vi.unstubAllGlobals());
it("cancels an owned desktop observation immediately and releases its listener", async () => {
  const request = vi.fn((..._args: any[]) => new Promise(() => {})),
    cancelRequest = vi.fn(async () => {});
  vi.stubGlobal("window", { alder: { request, cancelRequest } });
  const controller = new AbortController();
  const pending = api(
    "/api/speech/jobs/synthetic/events",
    "GET",
    undefined,
    controller.signal,
  );
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  await rejected;
  expect(cancelRequest).toHaveBeenCalledWith(request.mock.calls[0][3]);
});
it("keeps save and job submission outside transport cancellation", async () => {
  vi.stubGlobal("window", { alder: { request: vi.fn() } });
  for (const [path, method] of [
    ["/api/projects/p", "PUT"],
    ["/api/proofreading/check", "POST"],
  ])
    await expect(
      api(path, method, {}, new AbortController().signal),
    ).rejects.toThrow("must finish");
  expect(window.alder!.request).not.toHaveBeenCalled();
});
it("passes browser cancellation to fetch and never starts already cancelled work", async () => {
  const fetch = vi.fn(async (..._args: any[]) => ({
    ok: true,
    json: async () => ({ status: "ready" }),
  }));
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  await api("/api/health", "GET", undefined, controller.signal);
  expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  controller.abort();
  await expect(
    api("/api/health", "GET", undefined, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("bounds request ownership and prevents cancellation of durable mutations", () => {
  const requests = new RequestCancellation(),
    id = crypto.randomUUID();
  expect(() => requests.begin(id, "PUT", "/api/projects/p", {})).toThrow(
    "cannot",
  );
  const owned = requests.begin(id, "GET", "/api/health", undefined);
  expect(() => requests.begin(id, "GET", "/api/health", undefined)).toThrow(
    "identity",
  );
  requests.cancel(id);
  expect(owned.signal.aborted).toBe(true);
  owned.finish();
  const replacement = requests.begin(id, "POST", "/api/projects/p/export", {
    format: "pdf",
  });
  requests.dispose();
  expect(replacement.signal.aborted).toBe(true);
  replacement.finish();
  const all = Array.from({ length: 64 }, () =>
    requests.begin(crypto.randomUUID(), "GET", "/api/health", undefined),
  );
  expect(() =>
    requests.begin(crypto.randomUUID(), "GET", "/api/health", undefined),
  ).toThrow("Too many");
  requests.dispose();
  all.forEach((entry) => entry.finish());
});
