import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { api, upload } from './api';
import { openDocuments, type OpeningProgress } from './openDocuments';
import type { Project } from './types';
vi.mock('./api', () => ({ api: vi.fn(), upload: vi.fn() }));
const project = (id = 'opened') => ({ id, settings: { documentKind: 'docx', preferredFormat: 'docx' } }) as unknown as Project;
const file = (name = 'source.docx') => new File(['fixture words'], name);
const request = vi.mocked(api), transfer = vi.mocked(upload);
beforeEach(() => {
  vi.stubGlobal('window', {}); vi.stubGlobal('crypto', webcrypto);
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) ?? null });
  request.mockReset(); transfer.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('opens a staged result once, with progress and no blank workspace requests', async () => {
  const opened = vi.fn(), progress: OpeningProgress[] = [];
  transfer.mockResolvedValue({ id: 'job', status: 'reading' });
  request.mockImplementation(async (path, method) => {
    if (path === '/api/document-open-jobs/job' && method !== 'DELETE') return { id: 'job', status: 'ready' };
    if (path === '/api/document-open-jobs/job/open') return project();
    throw Error('Unexpected request '+path);
  });
  expect(await openDocuments([file()], opened, undefined, { progress: value => progress.push(value) })).toEqual(project());
  expect(opened).toHaveBeenCalledExactlyOnceWith(project());
  expect(progress.map(value => value.stage)).toContain('Reading');
  expect(progress.at(-1)?.cancellable).toBe(false);
  expect(request.mock.calls.every(([path]) => path.startsWith('/api/document-open-jobs/'))).toBe(true);
});

it('cancels an upload that finishes after Escape without ever committing it', async () => {
  const controller = new AbortController(), opened = vi.fn();
  let finish!: (job: unknown) => void;
  transfer.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  request.mockResolvedValue({ id: 'job', status: 'cancelled' });
  const result = openDocuments([file()], opened, undefined, { signal: controller.signal });
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(transfer).toHaveBeenCalledOnce());
  controller.abort(); finish({ id: 'job', status: 'ready' });
  await rejected;
  expect(opened).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/document-open-jobs/job', 'DELETE');
});

it('keeps earlier multi-file successes and stops at cancellation or failure', async () => {
  const controller = new AbortController(), opened = vi.fn();
  transfer.mockResolvedValue({ id: 'job', status: 'ready' });
  request.mockResolvedValue(project());
  const result = openDocuments([file('first.docx'), file('second.docx'), file('third.docx')], opened, undefined, {
    signal: controller.signal, progress: value => { if (value.index === 2) controller.abort(); },
  });
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(opened).toHaveBeenCalledOnce(); expect(transfer).toHaveBeenCalledOnce();
});

it('cleans a failed staged import and reports the parsing error', async () => {
  transfer.mockResolvedValue({ id: 'job', status: 'failed', error: 'Broken numbering.' });
  request.mockResolvedValue({ status: 'failed' });
  const opened = vi.fn();
  await expect(openDocuments([file()], opened)).rejects.toThrow('Broken numbering.');
  expect(opened).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/document-open-jobs/job', 'DELETE');
});

it('acknowledges the saved result if cancellation arrives after the atomic handoff', async () => {
  const controller = new AbortController(), opened = vi.fn();
  transfer.mockResolvedValue({ id: 'job', status: 'ready' });
  request.mockResolvedValue(project());
  await openDocuments([file()], opened, undefined, { signal: controller.signal, progress: value => { if (!value.cancellable) controller.abort(); } });
  expect(opened).toHaveBeenCalledExactlyOnceWith(project());
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/document-open-jobs/job/open', 'POST');
});

it('retains existing tabs and stages collected archives through the same cancellation path', async () => {
  const opened = vi.fn();
  await openDocuments([file()], opened, () => project('existing'));
  expect(opened).toHaveBeenCalledWith(project('existing'));
  expect(transfer).not.toHaveBeenCalled();
  transfer.mockResolvedValue({ id: 'archive-job', status: 'ready' });
  request.mockResolvedValue(project('archive'));
  const archive = file('book.alder');
  await openDocuments([archive], opened);
  expect(transfer).toHaveBeenCalledExactlyOnceWith('/api/document-open-jobs/import', archive);
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/document-open-jobs/archive-job/open', 'POST');
  expect(opened).toHaveBeenLastCalledWith(project('archive'));
});

it('binds a collected archive as its native format even if the writing document is plain text', async () => {
  const bindDocumentFile = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('window', { alder: { platform: 'win32', filePath: () => 'C:/Documents/Book.alder', bindDocumentFile } });
  transfer.mockResolvedValue({ id: 'archive-job', status: 'ready' });
  request.mockResolvedValue({ ...project('archive'), settings: { documentKind: 'txt', preferredFormat: 'txt' } });
  const archive = file('Book.alder');
  await openDocuments([archive], vi.fn());
  expect(bindDocumentFile).toHaveBeenCalledExactlyOnceWith('archive', archive, 'alder', true);
});
