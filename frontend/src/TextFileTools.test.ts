// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import TextFileTools from "./TextFileTools";
import { api } from "./api";
import type { Project } from "./types";
vi.mock("./api", async (original) => ({
  ...(await original<any>()),
  api: vi.fn(),
}));

it("reuses expected bytes when disk identity changes and aborts superseded revision requests", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let diskDigest = "first";
  const fileInfo = vi.fn(async () => ({
    path: "/synthetic.txt",
    format: "txt",
    digest: diskDigest,
    missing: false,
    changed: false,
  }));
  Object.defineProperty(window, "alder", {
    configurable: true,
    value: { documentFileInfo: fileInfo },
  });
  const pending: Array<{ signal: AbortSignal; resolve: (value: any) => void }> =
    [];
  vi.mocked(api).mockImplementation(
    (_path, _method, _body, signal) =>
      new Promise((resolve) => pending.push({ signal: signal!, resolve })),
  );
  const root = createRoot(document.createElement("div"));
  const project = {
    id: "plain",
    revision: 1,
    settings: { documentKind: "txt" },
    book: { chapters: [] },
  } as unknown as Project;
  const render = (p: Project) =>
    root.render(
      createElement(TextFileTools, {
        project: p,
        flush: async () => {},
        onOpen: async () => {},
        onSaveAs: () => {},
        visible: false,
      }),
    );
  try {
    await act(async () => render(project));
    expect(api).toHaveBeenCalledTimes(1);
    await act(async () =>
      pending[0].resolve({ revision: 1, digest: "expected" }),
    );
    diskDigest = "after-save";
    await act(async () =>
      window.dispatchEvent(new Event("alder-document-written")),
    );
    expect(fileInfo).toHaveBeenCalledTimes(2);
    expect(api).toHaveBeenCalledTimes(1);
    await act(async () => render({ ...project, revision: 2 }));
    expect(pending[0].signal.aborted).toBe(true);
    expect(api).toHaveBeenCalledTimes(2);
    await act(async () => render({ ...project, revision: 3 }));
    expect(pending[1].signal.aborted).toBe(true);
    expect(api).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
    expect(pending[2].signal.aborted).toBe(true);
  } finally {
    vi.mocked(api).mockReset();
    delete (window as any).alder;
    vi.unstubAllGlobals();
  }
});
