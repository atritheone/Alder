import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

type Binding = {
  path: string;
  digest: string;
  format: string;
  direct: boolean;
};
export type SaveMode = "save" | "saveAs" | "copy";
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export async function atomicDocumentWrite(
  destination: string,
  bytes: Uint8Array,
) {
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${randomUUID()}.tmp`,
  );
  try {
    const handle = await fs.open(temporary, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

/** Machine-local file identities never travel inside a portable project. */
export class DocumentFiles {
  private bindings: Record<string, Binding> | null = null;
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly statePath: string) {}
  private async read() {
    if (this.bindings) return this.bindings;
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Invalid records");
      const entries = Object.entries(parsed);
      for (const [id, raw] of entries) {
        const binding = raw as Binding;
        if (
          !/^[A-Za-z0-9][\w.-]{0,127}$/.test(id) ||
          !binding ||
          typeof binding.path !== "string" ||
          !path.isAbsolute(binding.path) ||
          !["alder", "docx", "odt", "rtf", "txt", "md"].includes(binding.format) ||
          typeof binding.digest !== "string" ||
          !/^[a-f0-9]{64}$/.test(binding.digest) ||
          typeof binding.direct !== "boolean"
        )
          throw new Error("Invalid records");
      }
      this.bindings = Object.assign(Object.create(null), parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "Document file records could not be read. Existing files were left unchanged.",
        );
    }
    return (this.bindings ||= Object.create(null) as Record<string, Binding>);
  }
  private async persist(bindings: Record<string, Binding>) {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    await atomicDocumentWrite(
      this.statePath,
      Buffer.from(JSON.stringify(bindings)),
    );
  }
  async bind(
    id: string,
    filename: string,
    format: string,
    direct: boolean,
    expectedDigest?: string,
  ) {
    if (!/^[A-Za-z0-9][\w.-]{0,127}$/.test(id) || !path.isAbsolute(filename))
      throw new Error("Invalid document identity.");
    const write = this.writes.then(async () => {
      const bytes = await fs.readFile(filename);
      if (expectedDigest && digest(bytes) !== expectedDigest)
        throw new Error(
          "This file changed while it was being reopened. The imported copy was preserved.",
        );
      const bindings = Object.assign(Object.create(null), await this.read(), {
        [id]: { path: filename, format, digest: digest(bytes), direct },
      });
      // Publish the identity only after its durable write succeeds. A failed
      // Save As must not redirect the next Save or discard another queued bind.
      await this.persist(bindings);
      this.bindings = bindings;
    });
    this.writes = write.catch(() => {});
    await write;
  }
  async destination(
    id: string,
    format: string,
    mode: SaveMode,
    choose: (suggested?: string) => Promise<string | null>,
  ) {
    const binding = (await this.read())[id];
    if (mode === "save" && binding?.format === format && binding.direct) {
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(binding.path);
      } catch {
        throw new Error(
          "The original file is no longer available. Use Save As to choose a destination.",
        );
      }
      if (digest(bytes) !== binding.digest)
        throw new Error(
          "This file changed outside Alder. Your work is still autosaved. Use Save As to keep both versions.",
        );
      return binding.path;
    }
    const suggested =
      binding && !binding.direct
        ? path.join(
            path.dirname(binding.path),
            `${path.parse(binding.path).name} - Alder copy.${format}`,
          )
        : binding?.path;
    return choose(suggested);
  }
  async formatFor(id: string, fallback: string) {
    return (await this.read())[id]?.format || fallback;
  }
  async pathFor(id: string) {
    return (await this.read())[id]?.path || null;
  }
  async info(id: string) {
    const binding = (await this.read())[id];
    if (!binding) return null;
    try {
      const stat = await fs.stat(binding.path);
      if (!stat.isFile())
        return { ...binding, missing: true, changed: true, size: 0 };
      if (stat.size > 30_000_000)
        return { ...binding, missing: false, changed: null, size: stat.size };
      const currentDigest = digest(await fs.readFile(binding.path));
      return {
        ...binding,
        missing: false,
        changed: currentDigest !== binding.digest,
        currentDigest,
        size: stat.size,
      };
    } catch (error) {
      if (
        ["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code || "",
        )
      )
        return { ...binding, missing: true, changed: true, size: 0 };
      throw new Error(
        "This file could not be checked. Your recovery workspace is preserved.",
      );
    }
  }
  async readTextFile(id: string) {
    const binding = (await this.read())[id];
    if (!binding || binding.format !== "txt")
      throw new Error("This document has no bound TXT file.");
    const stat = await fs.stat(binding.path);
    if (!stat.isFile() || stat.size > 30_000_000)
      throw new Error("TXT reopening currently supports files up to 30 MB.");
    const bytes = await fs.readFile(binding.path);
    if (bytes.length > 30_000_000)
      throw new Error("The TXT file grew beyond the reopening limit.");
    return {
      path: binding.path,
      name: path.basename(binding.path),
      digest: digest(bytes),
      bytes: Array.from(bytes),
    };
  }
  async bindReopened(
    sourceId: string,
    targetId: string,
    expectedDigest: string,
  ) {
    const source = (await this.read())[sourceId];
    if (
      !source ||
      source.format !== "txt" ||
      !/^[a-f0-9]{64}$/.test(expectedDigest)
    )
      throw new Error("Invalid TXT reopening identity.");
    await this.bind(targetId, source.path, "txt", true, expectedDigest);
  }
  async assertUnchanged(id: string, destination: string, mode: SaveMode) {
    const binding = (await this.read())[id];
    if (mode === "save" && binding?.direct && binding.path === destination) {
      if (digest(await fs.readFile(destination)) !== binding.digest)
        throw new Error(
          "This file changed while Alder was preparing the save. Use Save As to preserve both versions.",
        );
    }
  }
  async written(
    id: string,
    destination: string,
    format: string,
    mode: SaveMode,
  ) {
    if (mode !== "copy") await this.bind(id, destination, format, true);
  }
}
