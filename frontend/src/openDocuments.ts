import { api, upload } from "./api";
import type { Project } from "./types";

export type OpeningProgress = { name: string; index: number; total: number; stage: string; cancellable: boolean };
type OpeningOptions = { signal?: AbortSignal; progress?: (value: OpeningProgress) => void };
type OpeningJob = { id: string; status: string; error?: string };

const checkCancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Opening cancelled.', 'AbortError'); };
async function stagedDocument(file: File, options: OpeningOptions, progress: (stage: string, cancellable?: boolean) => void) {
  let job: OpeningJob | undefined, committed = false;
  const cancel = () => { if (job && !committed) void api(`/api/document-open-jobs/${job.id}`, 'DELETE').catch(() => {}); };
  options.signal?.addEventListener('abort', cancel);
  try {
    checkCancelled(options.signal);
    progress('Reading');
    job = await upload<OpeningJob>('/api/document-open-jobs/import', file);
    for (;;) {
      checkCancelled(options.signal);
      if (job.status === 'failed') throw new Error(job.error || 'This document could not be opened.');
      if (job.status === 'cancelled') throw new DOMException('Opening cancelled.', 'AbortError');
      if (job.status === 'ready') break;
      progress(job.status === 'collecting' ? 'Collecting images and formatting' : 'Reading');
      await new Promise(resolve => setTimeout(resolve, 100));
      checkCancelled(options.signal);
      job = await api<OpeningJob>(`/api/document-open-jobs/${job.id}`);
    }
    checkCancelled(options.signal);
    // Cancellation ends before the atomic saved-workspace handoff. A late
    // abort must not leave a successfully committed document unacknowledged.
    options.signal?.removeEventListener('abort', cancel);
    progress('Opening', false);
    const project = await api<Project>(`/api/document-open-jobs/${job.id}/open`, 'POST');
    committed = true;
    return project;
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    if (job && !committed) await api(`/api/document-open-jobs/${job.id}`, 'DELETE').catch(() => {});
  }
}

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
  options: OpeningOptions = {},
): Promise<Project | null> {
  let result: Project | null = null;
  for (const [index, file] of files.entries()) {
    checkCancelled(options.signal);
    const progress = (stage: string, cancellable = true) => options.progress?.({ name: file.name, index: index + 1, total: files.length, stage, cancellable });
    progress('Preparing');
    const path = window.alder?.filePath?.(file);
    const identity = path
      ? new TextEncoder().encode(
          window.alder?.platform === "win32" ? path.toLowerCase() : path,
        )
      : await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", identity);
    checkCancelled(options.signal);
    const sourceKey = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const existing = findSource?.(sourceKey);
    if (existing) {
      progress('Opening', false);
      result = existing;
      await onOpen(existing);
      continue;
    }
    result = await stagedDocument(file, options, progress);
    const archive = file.name.toLowerCase().endsWith('.alder');
    localStorage.setItem("alder.documentSource." + result.id, sourceKey);
    if (path)
      await window.alder?.bindDocumentFile?.(
        result.id,
        file,
        archive ? 'alder' : result.settings.preferredFormat,
        archive || result.settings.documentKind === "txt",
      );
    await onOpen(result);
  }
  return result;
}
