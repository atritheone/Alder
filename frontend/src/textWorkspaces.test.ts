import { it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { TextWorkspaces, matchesFileGlob } from "../../electron/textWorkspaces";
const temporary: string[] = [];
afterEach(async () => {
  for (const folder of temporary.splice(0))
    if (
      path.dirname(folder) === path.resolve(os.tmpdir()) &&
      path.basename(folder).startsWith("alder-folder-test-")
    )
      await fs.rm(folder, { recursive: true, force: true });
});
async function setup() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "alder-folder-test-"));
  temporary.push(folder);
  const root = path.join(folder, "source");
  await fs.mkdir(root);
  const service = new TextWorkspaces(
    path.join(folder, "state", "roots.json"),
    path.join(folder, "backups"),
    async (bytes, _digest, edits) => {
      let text = bytes.toString();
      for (const edit of [...edits].reverse())
        text =
          text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
      const result = Buffer.from(text);
      return {
        bytes: result.toString("base64"),
        digest: createHash("sha256").update(result).digest("hex"),
      };
    },
  );
  return { folder, root, service, workspace: await service.register(root) };
}
it("matches bounded wildcard filters including nested ** patterns", () => {
  expect(matchesFileGlob("one.TXT", "*.txt")).toBe(true);
  expect(matchesFileGlob("deep/a.txt", "**/*.txt")).toBe(true);
  expect(matchesFileGlob("a.txt", "**/*.txt")).toBe(true);
  expect(matchesFileGlob("deep/cache/a.txt", "**/cache/**")).toBe(true);
  expect(matchesFileGlob("a.md", "*.txt")).toBe(false);
});
it("lists selected files and rejects traversal outside the chosen root", async () => {
  const { root, service, workspace } = await setup();
  await fs.writeFile(path.join(root, "a.txt"), "old");
  await fs.mkdir(path.join(root, "sub"));
  await fs.writeFile(path.join(root, "sub", "b.TXT"), "other");
  await fs.writeFile(path.join(root, "skip.md"), "skip");
  expect(
    (await service.scan(workspace.id)).files.map((f) => f.relative),
  ).toEqual(["a.txt", "sub/b.TXT"]);
  await expect(service.read(workspace.id, "../outside.txt")).rejects.toThrow(
    "Invalid",
  );
  await expect(service.read(workspace.id, "a.txt:stream")).rejects.toThrow(
    "Invalid",
  );
});
it("backs up all originals before replacement and preserves newer work during restore", async () => {
  const { root, service, workspace } = await setup();
  for (const name of ["a.txt", "b.txt"])
    await fs.writeFile(path.join(root, name), "old");
  const plans = [];
  for (const relative of ["a.txt", "b.txt"]) {
    const source = await service.read(workspace.id, relative);
    plans.push({
      relative,
      digest: source.digest,
      edits: [{ start: 0, end: 3, originalText: "old", replacement: "new" }],
    });
  }
  const preview = await service.prepare(workspace.id, plans);
  expect(await fs.readFile(path.join(root, "a.txt"), "utf8")).toBe("old");
  const result = await service.commit(preview.token);
  expect(result.status).toBe("passed");
  expect(result.written).toBe(2);
  await fs.writeFile(path.join(root, "b.txt"), "newer authored work");
  const restored = await service.restore(result.token);
  expect(restored.status).toBe("partial");
  expect(restored.restored).toBe(1);
  expect(await fs.readFile(path.join(root, "a.txt"), "utf8")).toBe("old");
  expect(await fs.readFile(path.join(root, "b.txt"), "utf8")).toBe(
    "newer authored work",
  );
});
it("refuses a stale preview before writing any source file", async () => {
  const { root, service, workspace } = await setup();
  await fs.writeFile(path.join(root, "a.txt"), "old");
  const source = await service.read(workspace.id, "a.txt");
  const preview = await service.prepare(workspace.id, [
    {
      relative: "a.txt",
      digest: source.digest,
      edits: [{ start: 0, end: 3, originalText: "old", replacement: "new" }],
    },
  ]);
  await fs.writeFile(path.join(root, "a.txt"), "outside change");
  await expect(service.commit(preview.token)).rejects.toThrow(
    "No source files",
  );
  expect(await fs.readFile(path.join(root, "a.txt"), "utf8")).toBe(
    "outside change",
  );
});
it("excludes junction/symlink paths and refuses to read outside the root", async () => {
  const { folder, root, service, workspace } = await setup();
  const outside = path.join(folder, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "secret.txt"), "Outside fixture");
  await fs.symlink(outside, path.join(root, "linked"), "junction");
  expect((await service.scan(workspace.id)).files).toEqual([]);
  await expect(service.read(workspace.id, "linked/secret.txt")).rejects.toThrow(
    "Symbolic",
  );
});
it("can recover a completed write even if the process stopped before recording its completion", async () => {
  const { root, service, workspace } = await setup();
  await fs.writeFile(path.join(root, "a.txt"), "old");
  const source = await service.read(workspace.id, "a.txt");
  const preview = await service.prepare(workspace.id, [
    {
      relative: "a.txt",
      digest: source.digest,
      edits: [{ start: 0, end: 3, originalText: "old", replacement: "new" }],
    },
  ]);
  const committed = await service.commit(preview.token);
  const filename = path.join(committed.backup, "manifest.json"),
    manifest = JSON.parse(await fs.readFile(filename, "utf8"));
  manifest.entries[0].written = false;
  await fs.writeFile(filename, JSON.stringify(manifest));
  expect((await service.restore(preview.token)).restored).toBe(1);
  expect(await fs.readFile(path.join(root, "a.txt"), "utf8")).toBe("old");
});
