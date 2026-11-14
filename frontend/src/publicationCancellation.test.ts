import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  windows: [] as any[],
  release: undefined as undefined | (() => void),
}));
vi.mock("electron", () => ({
  BrowserWindow: class {
    destroyed = false;
    constructor() {
      state.windows.push(this);
    }
    setMenu() {}
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      state.release?.();
    }
    loadURL() {
      return new Promise<void>((resolve) => {
        state.release = resolve;
      });
    }
    webContents = {
      setWindowOpenHandler() {},
      on() {},
      executeJavaScript: vi.fn(async () => ({ pages: [1] })),
      printToPDF: vi.fn(async () => Buffer.from("pdf")),
    };
  },
}));
import { renderPublicationPdf } from "../../electron/publication";
it("destroys an active detached renderer, skips cancelled queued work and recovers the queue", async () => {
  const first = new AbortController(),
    queued = new AbortController();
  const active = renderPublicationPdf({}, "preload", true, first.signal);
  const waiting = renderPublicationPdf({}, "preload", true, queued.signal);
  const rejectedActive = expect(active).rejects.toMatchObject({
    name: "AbortError",
  });
  const rejectedWaiting = expect(waiting).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(state.windows).toHaveLength(1));
  queued.abort();
  first.abort();
  await rejectedActive;
  await rejectedWaiting;
  expect(state.windows).toHaveLength(1);
  expect(state.windows[0].destroyed).toBe(true);
  expect(state.windows[0].webContents.printToPDF).not.toHaveBeenCalled();
  const final = renderPublicationPdf({}, "preload");
  await vi.waitFor(() => expect(state.windows).toHaveLength(2));
  state.release!();
  expect((await final).data?.toString()).toBe("pdf");
  expect(state.windows[1].destroyed).toBe(true);
});
