import { api, upload } from "./api";
import { migrateBook } from "./book";
import type { Project } from "./types";

export async function rememberDocumentFile(id: string, path: string) {
  const bytes = new TextEncoder().encode(
    window.alder?.platform === "win32" ? path.toLowerCase() : path,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  localStorage.setItem(
    "alder.documentSource." + id,
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  );
}

/** Open each file independently, keeping earlier successes if a later import fails. */
export async function openDocuments(
  files: File[],
  onOpen: (project: Project) => void | Promise<void>,
  findSource?: (source: string) => Project | undefined,
): Promise<Project | null> {
  let result: Project | null = null;
  for (const file of files) {
    const path = window.alder?.filePath?.(file);
    const identity = path
      ? new TextEncoder().encode(
          window.alder?.platform === "win32" ? path.toLowerCase() : path,
        )
      : await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", identity);
    const sourceKey = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const existing = findSource?.(sourceKey);
    if (existing) {
      result = existing;
      await onOpen(existing);
      continue;
    }
    if (file.name.toLowerCase().endsWith(".alder")) {
      result = await upload<Project>("/api/projects/open-file", file);
      if (path)
        await window.alder?.bindDocumentFile?.(result.id, file, "alder", true);
      localStorage.setItem("alder.documentSource." + result.id, sourceKey);
      await onOpen(result);
      continue;
    }
    const project = await api<Project>("/api/projects", "POST", {
      name: file.name.replace(/\.[^.]+$/, ""),
      template: "blank",
    });
    const imported = migrateBook(
      await upload<Project>(`/api/projects/${project.id}/import`, file),
    );
    const kind = file.name.toLowerCase().endsWith(".txt") ? "txt" : "docx";
    Object.assign(imported.settings, {
      ...imported.lastImport?.pageSettings,
      documentKind: kind,
      preferredFormat: /\.(md|markdown)$/i.test(file.name) ? "md" : kind,
      includeTitle: false,
      footer: false,
    });
    result = await api<Project>(`/api/projects/${imported.id}`, "PUT", {
      expectedRevision: imported.revision,
      project: imported,
    });
    localStorage.setItem("alder.documentSource." + result.id, sourceKey);
    if (path)
      await window.alder?.bindDocumentFile?.(
        result.id,
        file,
        result.settings.preferredFormat,
        kind === "txt",
      );
    await onOpen(result);
  }
  return result;
}
