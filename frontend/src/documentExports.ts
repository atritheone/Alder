import { api } from './api';

export type ExportProgress = { stage: string; cancellable: boolean };
type ExportJob = { id: string; status: string; error?: string };
const cancelled = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError'); };

/** Prepare a saved snapshot; expose its download only after the final handoff. */
export async function prepareExport(projectId: string, request: unknown, signal: AbortSignal, progress: (value: ExportProgress) => void) {
  cancelled(signal);
  // Desktop PDF must use the measured renderer and verified PDF handoff.
  if ((request as { format?: string } | null)?.format === 'pdf') {
    progress({ stage: 'Measuring and building PDF', cancellable: true });
    return api(`/api/projects/${projectId}/export`, 'POST', request, signal);
  }
  let job: ExportJob | undefined, completed = false;
  const cancel = () => { if (job && !completed) void api(`/api/document-export-jobs/${job.id}`, 'DELETE').catch(() => {}); };
  signal.addEventListener('abort', cancel);
  try {
    cancelled(signal);
    progress({ stage: 'Preparing export', cancellable: true });
    job = await api<ExportJob>(`/api/projects/${projectId}/export-jobs`, 'POST', request);
    for (;;) {
      cancelled(signal);
      if (job.status === 'failed') throw Error(job.error || 'The document could not be exported.');
      if (job.status === 'cancelled') throw new DOMException('Export cancelled.', 'AbortError');
      if (job.status === 'ready') break;
      progress({ stage: job.status === 'queued' ? 'Waiting to export' : 'Building export', cancellable: true });
      await new Promise(resolve => setTimeout(resolve, 100));
      cancelled(signal);
      job = await api<ExportJob>(`/api/document-export-jobs/${job.id}`);
    }
    cancelled(signal);
    signal.removeEventListener('abort', cancel);
    progress({ stage: 'Finishing export', cancellable: false });
    const result = await api(`/api/document-export-jobs/${job.id}/complete`, 'POST');
    completed = true;
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (job && !completed) await api(`/api/document-export-jobs/${job.id}`, 'DELETE').catch(() => {});
  }
}
