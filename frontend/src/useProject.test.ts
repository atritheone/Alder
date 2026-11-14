// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "./api";
import { useProject } from "./useProject";
import type { Project } from "./types";
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  api: vi.fn(),
}));
it("flushes before close and rehydrates the durable revision on reopen, retaining failures for retry", async () => {
  localStorage.clear();
  localStorage.setItem("alder.txt.restoreSession", "false");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const initial = {
    id: "closed",
    name: "Book",
    revision: 1,
    book: { version: 1, chapters: [] },
    settings: {},
    clips: [],
  } as unknown as Project;
  let durable = initial;
  vi.mocked(api).mockImplementation(async (_path, method, body: any) => {
    if (method === "PUT")
      durable = { ...body.project, revision: durable.revision + 1 };
    return durable;
  });
  const host = document.createElement("div"),
    root = createRoot(host);
  let project!: ReturnType<typeof useProject>;
  function Example() {
    project = useProject();
    return null;
  }
  await act(async () => root.render(createElement(Example)));
  await act(async () => project.load(initial));
  await act(async () =>
    project.change((draft) => {
      draft.name = "Saved edit";
    }),
  );
  await act(async () => project.close(initial.id));
  expect(durable.name).toBe("Saved edit");
  expect(project.project).toBeNull();
  durable = { ...durable, name: "Newer durable revision", revision: 3 };
  vi.mocked(api).mockRejectedValueOnce(new Error("Offline"));
  await act(async () => {
    await expect(project.reopenClosed()).rejects.toThrow("Offline");
  });
  await act(async () => project.reopenClosed());
  expect(project.project?.name).toBe("Newer durable revision");
  expect(api).toHaveBeenLastCalledWith("/api/projects/closed");
  await act(async () => root.unmount());
  vi.mocked(api).mockReset();
  vi.unstubAllGlobals();
});
it("applies compact save replies to their request snapshot while coalescing newer edits", async () => {
  localStorage.clear();
  localStorage.setItem("alder.txt.restoreSession", "false");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const initial = {
    id: "p",
    name: "Before",
    revision: 1,
    book: { version: 1, chapters: [] },
    settings: {},
    clips: [],
  } as unknown as Project;
  let project!: ReturnType<typeof useProject>, finish!: (reply: any) => void;
  const submitted: any[] = [];
  vi.mocked(api).mockImplementation(async (_path, _method, body: any) => {
    submitted.push(body);
    if (submitted.length === 1)
      return new Promise((resolve) => {
        finish = resolve;
      });
    return {
      savedRevision: 3,
      changes: [
        { path: ["revision"], value: 3 },
        { path: ["updatedAt"], value: "last" },
      ],
    };
  });
  const host = document.createElement("div"),
    root = createRoot(host);
  function Example() {
    project = useProject();
    return null;
  }
  await act(async () => root.render(createElement(Example)));
  await act(async () => project.load(initial));
  await act(async () =>
    project.change((draft) => {
      draft.name = "First edit";
    }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = project.flush();
  });
  await act(async () =>
    project.change((draft) => {
      draft.name = "Latest edit";
    }),
  );
  await act(async () => {
    finish({
      savedRevision: 2,
      changes: [
        { path: ["revision"], value: 2 },
        { path: ["name"], value: "First canonical edit" },
      ],
    });
    await pending;
  });
  expect(submitted).toHaveLength(2);
  expect(submitted[1].expectedRevision).toBe(2);
  expect(submitted[1].project.name).toBe("Latest edit");
  expect(project.project?.name).toBe("Latest edit");
  expect(project.project?.revision).toBe(3);
  expect(project.saveState).toBe("Saved");
  expect(initial.name).toBe("Before");
  await act(async () => root.unmount());
  vi.mocked(api).mockReset();
  vi.unstubAllGlobals();
});
