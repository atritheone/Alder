import { api, upload } from "./api";
import { migrateBook } from "./book";
import type { Project } from "./types";

/** Each dropped file opens as its own saved workspace; the last is shown. */
export async function openDocuments(files: File[]): Promise<Project | null> {
  let result: Project | null = null;
  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".alder")) {
      result = await upload<Project>("/api/projects/open-file", file);
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
      documentKind: kind,
      preferredFormat: kind,
      includeTitle: false,
      footer: false,
    });
    result = await api<Project>(`/api/projects/${imported.id}`, "PUT", {
      expectedRevision: imported.revision,
      project: imported,
    });
  }
  return result;
}
