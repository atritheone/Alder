import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DocumentFiles,
  atomicDocumentWrite,
} from "../../electron/documentFiles";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0))
    await fs.rm(dir, { recursive: true, force: true });
});
async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alder-file-test-"));
  directories.push(dir);
  const file = path.join(dir, "document.txt"),
    records = path.join(dir, "state.json");
  await fs.writeFile(file, "Original");
  return { file, records, dir, store: new DocumentFiles(records) };
}
describe("document file identities", () => {
  it("preserves the previous bytes and removes staging files when a flush fails", async () => {
    const { file, dir } = await setup();
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(
      async (...args: Parameters<typeof fs.open>) => {
        const handle = await open(...args);
        if (String(args[0]).endsWith(".tmp")) {
          handle.sync = async () => {
            throw Object.assign(new Error("Disk full"), { code: "ENOSPC" });
          };
        }
        return handle;
      },
    );
    await expect(
      atomicDocumentWrite(file, Buffer.from("Replacement")),
    ).rejects.toMatchObject({ code: "ENOSPC" });
    expect(await fs.readFile(file, "utf8")).toBe("Original");
    expect(
      (await fs.readdir(dir)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });
  it("retains the old binding in memory and on disk after a failed Save As record", async () => {
    const { file, records, dir, store } = await setup();
    await store.bind("project", file, "txt", true);
    const next = path.join(dir, "new.txt");
    await fs.writeFile(next, "New wording");
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (to === records)
        throw Object.assign(new Error("Disk full"), { code: "ENOSPC" });
      return rename(from, to);
    });
    await expect(
      store.bind("project", next, "txt", true),
    ).rejects.toMatchObject({ code: "ENOSPC" });
    expect(
      await store.destination("project", "txt", "save", async () => null),
    ).toBe(file);
    expect(
      await new DocumentFiles(records).destination(
        "project",
        "txt",
        "save",
        async () => null,
      ),
    ).toBe(file);
    vi.restoreAllMocks();
    await store.bind("project", next, "txt", true);
    expect(
      await store.destination("project", "txt", "save", async () => null),
    ).toBe(next);
  });
  it("serializes simultaneous document bindings without dropping either record", async () => {
    const { file, records, dir, store } = await setup();
    const other = path.join(dir, "other.txt");
    await fs.writeFile(other, "Other");
    await Promise.all([
      store.bind("first", file, "txt", true),
      store.bind("second", other, "txt", true),
    ]);
    const reopened = new DocumentFiles(records);
    expect(
      await reopened.destination("first", "txt", "save", async () => null),
    ).toBe(file);
    expect(
      await reopened.destination("second", "txt", "save", async () => null),
    ).toBe(other);
  });
  it("saves to the bound file after restarting and detects external edits", async () => {
    const { store, file, records } = await setup();
    await store.bind("project", file, "txt", true);
    const reopened = new DocumentFiles(records);
    expect(
      await reopened.destination("project", "txt", "save", async () => {
        throw new Error("Must not prompt");
      }),
    ).toBe(file);
    await atomicDocumentWrite(file, Buffer.from("External edit"));
    await expect(
      reopened.destination("project", "txt", "save", async () => null),
    ).rejects.toThrow("changed outside Alder");
    expect(await fs.readFile(file, "utf8")).toBe("External edit");
  });
  it("keeps the original identity when saving a copy and leaves files untouched on cancellation", async () => {
    const { store, file, dir } = await setup();
    await store.bind("project", file, "txt", true);
    expect(
      await store.destination("project", "txt", "saveAs", async () => null),
    ).toBeNull();
    const copy = path.join(dir, "copy.txt");
    await atomicDocumentWrite(copy, Buffer.from("Copy"));
    await store.written("project", copy, "txt", "copy");
    expect(
      await store.destination("project", "txt", "save", async () => null),
    ).toBe(file);
    expect(await fs.readFile(file, "utf8")).toBe("Original");
  });
  it("does not overwrite an imported file with incomplete format support", async () => {
    const { store, file } = await setup();
    await store.bind("project", file, "docx", false);
    let suggested = "";
    await store.destination("project", "docx", "save", async (name) => {
      suggested = name!;
      return null;
    });
    expect(suggested).toContain("Alder copy.docx");
    expect(await fs.readFile(file, "utf8")).toBe("Original");
  });
  it("detects a modification during export and preserves the newer file", async () => {
    const { store, file } = await setup();
    await store.bind("project", file, "txt", true);
    await store.destination("project", "txt", "save", async () => null);
    await fs.writeFile(file, "Changed during export");
    await expect(
      store.assertUnchanged("project", file, "save"),
    ).rejects.toThrow("changed while");
    expect(await fs.readFile(file, "utf8")).toBe("Changed during export");
  });
  it("saves an Alder bundle as a bundle even if its inner document was plain text", async () => {
    const { store, file } = await setup();
    await store.bind("project", file, "alder", true);
    expect(await store.formatFor("project", "txt")).toBe("alder");
    expect(await store.formatFor("new-project", "docx")).toBe("docx");
  });
});
