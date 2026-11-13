import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicDocumentWrite } from "./documentFiles";
import { decodeTextBytes } from "../frontend/src/decodeTextBytes";

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const comparable = (value: string) =>
  process.platform === "win32" ? value.toLowerCase() : value;
const inside = (root: string, filename: string) =>
  comparable(filename).startsWith(
    comparable(root.endsWith(path.sep) ? root : root + path.sep),
  );
type Root = { id: string; path: string; name: string };
export type FolderEdit = {
  start: number;
  end: number;
  originalText: string;
  replacement: string;
};
type Plan = { relative: string; digest: string; edits: FolderEdit[] };
type PreparedFile = {
  relative: string;
  original: Buffer;
  replacement: Buffer;
  originalDigest: string;
  newDigest: string;
  count: number;
};
type Entry = {
  relative: string;
  originalDigest: string;
  newDigest: string;
  backup: string;
  written: boolean;
  restored?: boolean;
};
type Manifest = {
  version: 1;
  rootId: string;
  rootPath: string;
  entries: Entry[];
};

function wildcard(pattern: string, text: string): boolean {
  let p = 0,
    t = 0,
    star = -1,
    retry = 0;
  while (t < text.length) {
    if (pattern[p] === "?" || pattern[p] === text[t]) {
      p++;
      t++;
    } else if (pattern[p] === "*") {
      star = p++;
      retry = t;
    } else if (star >= 0) {
      p = star + 1;
      t = ++retry;
    } else return false;
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}
export function matchesFileGlob(relative: string, pattern: string): boolean {
  const parts = relative.replace(/\\/g, "/").toLowerCase().split("/"),
    glob = pattern.replace(/\\/g, "/").toLowerCase().split("/");
  if (glob.length === 1) return wildcard(glob[0], parts.at(-1) || "");
  const memo = new Map<string, boolean>();
  const match = (p: number, t: number): boolean => {
    const key = p + ":" + t,
      known = memo.get(key);
    if (known !== undefined) return known;
    const result =
      p === glob.length
        ? t === parts.length
        : glob[p] === "**"
          ? match(p + 1, t) || (t < parts.length && match(p, t + 1))
          : t < parts.length &&
            wildcard(glob[p], parts[t]) &&
            match(p + 1, t + 1);
    memo.set(key, result);
    return result;
  };
  return match(0, 0);
}
function patterns(value: string, fallback: string) {
  return (value || fallback)
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((v) => v.slice(0, 256));
}

/** Only roots chosen through the OS folder picker are exposed to the renderer. */
export class TextWorkspaces {
  private roots: Record<string, Root> | null = null;
  private scans = new Map<string, AbortController>();
  private prepared = new Map<
    string,
    { root: Root; files: PreparedFile[]; created: number }
  >();
  private writing = false;
  private registrations: Promise<unknown> = Promise.resolve();
  constructor(
    private statePath: string,
    private backupRoot: string,
    private prepareBytes: (
      source: Buffer,
      sourceDigest: string,
      edits: FolderEdit[],
    ) => Promise<{ bytes: string; digest: string }>,
  ) {}
  private async readRoots() {
    if (this.roots) return this.roots;
    try {
      const value = JSON.parse(await fs.readFile(this.statePath, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid folder records.");
      for (const [id, root] of Object.entries(value) as [string, Root][])
        if (
          !/^workspace_[a-f0-9-]+$/.test(id) ||
          root.id !== id ||
          !path.isAbsolute(root.path) ||
          typeof root.name !== "string"
        )
          throw new Error("Invalid folder records.");
      this.roots = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.roots = Object.create(null);
    }
    return this.roots!;
  }
  async list() {
    return Object.values(await this.readRoots());
  }
  async register(directory: string) {
    const next = this.registrations.then(() => this.registerRoot(directory));
    this.registrations = next.catch(() => {});
    return next;
  }
  private async registerRoot(directory: string) {
    const resolved = await fs.realpath(directory);
    if (!(await fs.stat(resolved)).isDirectory())
      throw new Error("Choose a folder.");
    const backups = path.resolve(this.backupRoot);
    if (
      comparable(resolved) === comparable(backups) ||
      inside(backups, resolved)
    )
      throw new Error(
        "Choose source files rather than the replacement backup folder.",
      );
    const roots = await this.readRoots(),
      existing = Object.values(roots).find(
        (root) => comparable(root.path) === comparable(resolved),
      );
    if (existing) return existing;
    const root = {
      id: "workspace_" + randomUUID(),
      path: resolved,
      name: path.basename(resolved) || resolved,
    };
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const next = { ...roots, [root.id]: root };
    await atomicDocumentWrite(
      this.statePath,
      Buffer.from(JSON.stringify(next)),
    );
    this.roots = next;
    return root;
  }
  private async root(id: string) {
    const root = (await this.readRoots())[id];
    if (!root) throw new Error("Choose a folder workspace first.");
    const resolved = await fs.realpath(root.path);
    if (comparable(resolved) !== comparable(root.path))
      throw new Error("The folder identity changed. Choose it again.");
    return root;
  }
  private async filename(root: Root, relative: string) {
    if (
      typeof relative !== "string" ||
      relative.length > 4096 ||
      path.isAbsolute(relative)
    )
      throw new Error("Invalid workspace file path.");
    const parts = relative.replace(/\\/g, "/").split("/");
    if (parts.some((p) => !p || p === "." || p === ".." || /[:\0]/.test(p)))
      throw new Error("Invalid workspace file path.");
    let current = root.path;
    for (const part of parts) {
      current = path.join(current, part);
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error("Symbolic links are excluded from folder editing.");
    }
    const resolved = await fs.realpath(current);
    if (
      !inside(root.path, resolved) ||
      inside(path.resolve(this.backupRoot), resolved)
    )
      throw new Error("This file is outside the source workspace.");
    return resolved;
  }
  private async bytes(root: Root, relative: string) {
    const filename = await this.filename(root, relative),
      stat = await fs.stat(filename);
    if (!stat.isFile() || stat.size > 8_000_000)
      throw new Error(
        "Folder editing supports text files up to eight megabytes each.",
      );
    const bytes = await fs.readFile(filename);
    if (bytes.length > 8_000_000)
      throw new Error("This file grew beyond the folder editing limit.");
    return { filename, bytes };
  }
  cancel(id: string) {
    this.scans.get(id)?.abort();
  }
  async scan(
    id: string,
    include = "*.txt",
    exclude = ".git/**;node_modules/**;.venv/**",
  ) {
    const root = await this.root(id),
      controller = new AbortController();
    this.cancel(id);
    this.scans.set(id, controller);
    const includes = patterns(include, "*.txt"),
      excludes = patterns(exclude, ".git/**;node_modules/**;.venv/**"),
      files: { relative: string; size: number }[] = [],
      warnings: string[] = [];
    let truncated = false;
    const walk = async (relative: string, depth: number): Promise<void> => {
      if (controller.signal.aborted) throw new Error("Folder scan cancelled.");
      if (depth > 64) {
        warnings.push("Skipped a folder deeper than 64 levels.");
        return;
      }
      const directory = path.join(root.path, relative),
        resolved = await fs.realpath(directory);
      if (
        comparable(resolved) !== comparable(root.path) &&
        !inside(root.path, resolved)
      )
        return;
      if (
        comparable(resolved) === comparable(path.resolve(this.backupRoot)) ||
        inside(path.resolve(this.backupRoot), resolved)
      )
        return;
      for (const entry of await fs.readdir(directory, {
        withFileTypes: true,
      })) {
        if (controller.signal.aborted)
          throw new Error("Folder scan cancelled.");
        if (files.length >= 10000) {
          truncated = true;
          return;
        }
        const name = (relative ? relative + "/" : "") + entry.name;
        if (entry.isSymbolicLink()) continue;
        if (
          excludes.some(
            (pattern) =>
              matchesFileGlob(name, pattern) ||
              (entry.isDirectory() && matchesFileGlob(name + "/", pattern)),
          )
        )
          continue;
        if (entry.isDirectory()) {
          if ([".git", "node_modules", ".venv"].includes(entry.name)) continue;
          try {
            await walk(name, depth + 1);
          } catch (error) {
            if (controller.signal.aborted) throw error;
            warnings.push(`Could not read ${name}.`);
          }
        } else if (
          entry.isFile() &&
          includes.some((pattern) => matchesFileGlob(name, pattern))
        ) {
          const stat = await fs.stat(path.join(root.path, name));
          files.push({ relative: name, size: stat.size });
        }
      }
    };
    try {
      await walk("", 0);
      return {
        root,
        files: files.sort((a, b) => a.relative.localeCompare(b.relative)),
        truncated,
        warnings: warnings.slice(0, 100),
      };
    } finally {
      if (this.scans.get(id) === controller) this.scans.delete(id);
    }
  }
  async read(id: string, relative: string) {
    const root = await this.root(id),
      { bytes } = await this.bytes(root, relative);
    if (
      bytes.includes(0) &&
      !bytes.subarray(0, 2).equals(Buffer.from([255, 254])) &&
      !bytes.subarray(0, 2).equals(Buffer.from([254, 255]))
    )
      throw new Error(
        "Skipped a file that does not appear to contain plain text.",
      );
    return { relative, text: decodeTextBytes(bytes), digest: digest(bytes) };
  }
  async fileForOpen(id: string, relative: string) {
    const root = await this.root(id),
      { filename, bytes } = await this.bytes(root, relative);
    return {
      path: filename,
      name: path.basename(filename),
      bytes: Array.from(bytes),
      digest: digest(bytes),
    };
  }
  async pathForBinding(id: string, relative: string, expectedDigest: string) {
    const root = await this.root(id),
      source = await this.bytes(root, relative);
    if (digest(source.bytes) !== expectedDigest)
      throw new Error("The workspace file changed during opening.");
    return source.filename;
  }
  async prepare(id: string, plans: Plan[]) {
    if (
      !Array.isArray(plans) ||
      !plans.length ||
      plans.length > 200 ||
      new Set(plans.map((p) => p.relative)).size !== plans.length
    )
      throw new Error("Preview 1–200 distinct files per replacement batch.");
    const root = await this.root(id),
      files: PreparedFile[] = [];
    let total = 0;
    for (const plan of plans) {
      const { bytes } = await this.bytes(root, plan.relative),
        originalDigest = digest(bytes);
      if (originalDigest !== plan.digest)
        throw new Error(
          `${plan.relative} changed. Search again before replacing.`,
        );
      const result = await this.prepareBytes(bytes, originalDigest, plan.edits),
        replacement = Buffer.from(result.bytes, "base64");
      if (
        replacement.length > 8_000_000 ||
        digest(replacement) !== result.digest
      )
        throw new Error("Replacement output failed verification.");
      total += bytes.length + replacement.length;
      if (total > 64_000_000)
        throw new Error(
          "Preview a smaller batch (at most 64 MB including original and replacement bytes).",
        );
      files.push({
        relative: plan.relative,
        original: bytes,
        replacement,
        originalDigest,
        newDigest: result.digest,
        count: plan.edits.length,
      });
    }
    for (const [token, item] of this.prepared)
      if (Date.now() - item.created > 900000) this.prepared.delete(token);
    while (this.prepared.size >= 4)
      this.prepared.delete(this.prepared.keys().next().value!);
    const token = "replace_" + randomUUID();
    this.prepared.set(token, { root, files, created: Date.now() });
    return {
      token,
      files: files.map((f) => ({
        relative: f.relative,
        replacements: f.count,
        originalDigest: f.originalDigest,
        newDigest: f.newDigest,
      })),
    };
  }
  async commit(token: string) {
    if (this.writing)
      throw new Error("Wait for the current folder write to finish.");
    this.writing = true;
    try {
      return await this.commitPrepared(token);
    } finally {
      this.writing = false;
    }
  }
  private async commitPrepared(token: string) {
    const prepared = this.prepared.get(token);
    if (!prepared || Date.now() - prepared.created > 900000)
      throw new Error("This replacement preview expired. Prepare it again.");
    this.prepared.delete(token);
    const { root, files } = prepared;
    await this.root(root.id);
    for (const file of files)
      if (
        digest((await this.bytes(root, file.relative)).bytes) !==
        file.originalDigest
      )
        throw new Error(
          `${file.relative} changed after preview. No source files were written.`,
        );
    const directory = path.join(path.resolve(this.backupRoot), token);
    await fs.mkdir(path.resolve(this.backupRoot), { recursive: true });
    await fs.mkdir(directory);
    const manifest: Manifest = {
      version: 1,
      rootId: root.id,
      rootPath: root.path,
      entries: [],
    };
    for (const file of files) {
      const backup = digest(Buffer.from(file.relative)) + ".bin";
      await atomicDocumentWrite(path.join(directory, backup), file.original);
      if (
        digest(await fs.readFile(path.join(directory, backup))) !==
        file.originalDigest
      )
        throw new Error(
          "The original-file backup failed verification. No source files were written.",
        );
      manifest.entries.push({
        relative: file.relative,
        originalDigest: file.originalDigest,
        newDigest: file.newDigest,
        backup,
        written: false,
      });
    }
    const save = () =>
      atomicDocumentWrite(
        path.join(directory, "manifest.json"),
        Buffer.from(JSON.stringify(manifest, null, 2)),
      );
    await save();
    const errors: string[] = [];
    let written = 0;
    for (const [index, file] of files.entries()) {
      try {
        const current = await this.bytes(root, file.relative);
        if (digest(current.bytes) !== file.originalDigest)
          throw new Error("The source changed after backup.");
        await atomicDocumentWrite(current.filename, file.replacement);
        manifest.entries[index].written = true;
        written++;
        await save();
        if (digest(await fs.readFile(current.filename)) !== file.newDigest)
          throw new Error("The file changed during write verification.");
      } catch (error) {
        errors.push(`${file.relative}: ${(error as Error).message}`);
        break;
      }
    }
    return {
      status: errors.length ? "partial" : "passed",
      written,
      total: files.length,
      backup: directory,
      token,
      errors,
    };
  }
  async restore(token: string) {
    if (this.writing)
      throw new Error("Wait for the current folder write to finish.");
    this.writing = true;
    try {
      return await this.restorePrepared(token);
    } finally {
      this.writing = false;
    }
  }
  private async restorePrepared(token: string) {
    if (!/^replace_[a-f0-9-]+$/.test(token))
      throw new Error("Invalid replacement backup identity.");
    const directory = path.join(path.resolve(this.backupRoot), token),
      manifest = JSON.parse(
        await fs.readFile(path.join(directory, "manifest.json"), "utf8"),
      ) as Manifest;
    if (manifest.version !== 1 || !Array.isArray(manifest.entries))
      throw new Error("Invalid replacement backup.");
    const root = await this.root(manifest.rootId);
    if (root.path !== manifest.rootPath)
      throw new Error("The original workspace identity changed.");
    let restored = 0;
    const errors: string[] = [];
    for (const entry of manifest.entries) {
      if (entry.restored) continue;
      try {
        if (!/^[a-f0-9]{64}\.bin$/.test(entry.backup))
          throw new Error("Invalid backup filename.");
        const old = await fs.readFile(path.join(directory, entry.backup));
        if (digest(old) !== entry.originalDigest)
          throw new Error("Backup bytes failed verification.");
        const current = await this.bytes(root, entry.relative),
          currentDigest = digest(current.bytes);
        if (!entry.written && currentDigest === entry.originalDigest) continue;
        if (currentDigest !== entry.newDigest)
          throw new Error("Newer work exists; it was preserved.");
        await atomicDocumentWrite(current.filename, old);
        entry.restored = true;
        restored++;
        await atomicDocumentWrite(
          path.join(directory, "manifest.json"),
          Buffer.from(JSON.stringify(manifest, null, 2)),
        );
      } catch (error) {
        errors.push(`${entry.relative}: ${(error as Error).message}`);
      }
    }
    return {
      status: errors.length ? "partial" : "passed",
      restored,
      backup: directory,
      errors,
    };
  }
}
