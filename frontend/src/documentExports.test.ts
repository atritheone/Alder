// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn() }));
import { api } from './api';
import { prepareExport } from './documentExports';
const request = vi.mocked(api);
beforeEach(() => { request.mockReset(); });

it('polls preparation and only exposes the completed download', async () => {
  const calls: string[] = [];
  request.mockImplementation(async (path, method) => {
    calls.push(`${method || 'GET'} ${path}`);
    if (path.endsWith('/export-jobs')) return { id: 'one', status: 'queued' };
    if (path.endsWith('/complete')) return { downloadUrl: '/api/exports/one' };
    return { id: 'one', status: 'ready' };
  });
  const progress = vi.fn();
  expect(await prepareExport('project', { format: 'txt' }, new AbortController().signal, progress)).toEqual({ downloadUrl: '/api/exports/one' });
  expect(calls).toEqual(['POST /api/projects/project/export-jobs', 'GET /api/document-export-jobs/one', 'POST /api/document-export-jobs/one/complete']);
  expect(progress).toHaveBeenLastCalledWith({ stage: 'Finishing export', cancellable: false });
});

it('cancels a job created after the user already pressed Cancel', async () => {
  const controller = new AbortController(); let finish!: (value: unknown) => void;
  request.mockImplementation(async (_path, method) => method === 'DELETE' ? {} : new Promise(resolve => { finish = resolve; }));
  const pending = prepareExport('project', {}, controller.signal, () => {});
  controller.abort(); finish({ id: 'late', status: 'ready' });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(request).toHaveBeenLastCalledWith('/api/document-export-jobs/late', 'DELETE');
  expect(request.mock.calls.some(([path]) => path.endsWith('/complete'))).toBe(false);
});

it('cancellation during polling never starts publication', async () => {
  const controller = new AbortController();
  request.mockResolvedValue({ id: 'one', status: 'building' });
  await expect(prepareExport('project', {}, controller.signal, progress => {
    if (progress.stage === 'Building export') controller.abort();
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(request.mock.calls.some(([path]) => path.endsWith('/complete'))).toBe(false);
  expect(request).toHaveBeenLastCalledWith('/api/document-export-jobs/one', 'DELETE');
});

it('cleans failed preparation while preserving its actual error', async () => {
  request.mockResolvedValue({ id: 'one', status: 'failed', error: 'Invalid table geometry.' });
  await expect(prepareExport('project', {}, new AbortController().signal, () => {})).rejects.toThrow('Invalid table geometry.');
  expect(request).toHaveBeenLastCalledWith('/api/document-export-jobs/one', 'DELETE');
});

it('keeps a successful handoff acknowledged even if abort arrives during it', async () => {
  const controller = new AbortController();
  request.mockImplementation(async path => {
    if (path.endsWith('/complete')) { controller.abort(); return { downloadUrl: 'result' }; }
    return { id: 'one', status: 'ready' };
  });
  expect(await prepareExport('project', {}, controller.signal, () => {})).toEqual({ downloadUrl: 'result' });
  expect(request.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false);
});

it('keeps PDF on the desktop measured-publication route', async () => {
  request.mockResolvedValue({ downloadUrl: 'verified-pdf' });
  const progress = vi.fn();
  expect(await prepareExport('project', { format: 'pdf' }, new AbortController().signal, progress)).toEqual({ downloadUrl: 'verified-pdf' });
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/projects/project/export', 'POST', { format: 'pdf' });
  expect(progress).toHaveBeenLastCalledWith({ stage: 'Measuring and building PDF', cancellable: false });
});
