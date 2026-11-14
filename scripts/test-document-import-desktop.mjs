// Real staged imports; hold status delivery to make Cancel/Escape deterministic.
import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const directory = path.resolve('work/document-import-ui'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'alder-import-ui-'));
fs.mkdirSync(directory, { recursive: true });
const report = { status: 'running', errors: [], checks: [] }; let app, page;
try {
  app = await electron.launch({ executablePath: desktopExecutable(), args: ['.', '--headless-test', `--user-data-dir=${profile}/profile`], env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` } });
  page = await app.firstWindow(); page.setDefaultTimeout(30000); page.on('pageerror', error => report.errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 1000); w.show(); w.focus();
    const original = globalThis.fetch; globalThis.openingJobs = new Map(); globalThis.holdOpening = new Set(['Cancelled.txt', 'Second.txt', 'Cancelled.alder']);
    globalThis.fetch = async (...args) => {
      const response = await original(...args), url = String(args[0]), method = args[1]?.method || 'GET';
      if (/\/api\/document-open-jobs\/import$/.test(url) && response.ok) {
        const job = await response.clone().json(); globalThis.openingJobs.set(job.id, job.name);
      }
      if (/\/api\/document-open-jobs\/opening_[^/]+$/.test(url) && method === 'GET' && response.ok) {
        const job = await response.clone().json();
        if (globalThis.holdOpening.has(job.name) && !['cancelled', 'failed', 'completed'].includes(job.status))
          return new Response(JSON.stringify({ ...job, status: 'reading' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return response;
    };
  });
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
  const upload = files => page.evaluate(files => {
    const input = document.querySelector('input[aria-label="Open documents"]') || document.querySelector('.start-screen input[type="file"]');
    const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(new File([file.text], file.name, { type: 'text/plain' })));
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, files);
  const progress = page.locator('.document-opening-progress');
  const count = () => page.evaluate(async () => (await window.alder.request('GET', '/api/projects')).projects.length);
  await upload([{ name: 'Cancelled.txt', text: 'Do not save this document.' }]);
  await expect(progress).toContainText('Reading Cancelled.txt');
  await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(progress).not.toBeVisible(); await expect.poll(count).toBe(0);
  await expect(page.locator('.start-screen')).toBeVisible();
  report.checks.push('Cancel on start leaves no workspace.');
  await upload([{ name: 'Original.txt', text: 'The existing document remains available.' }]);
  const editor = page.getByRole('textbox', { name: /^(Chapter text editor|TXT text editor)$/ });
  await expect(editor).toContainText('The existing document remains available.'); await expect(progress).not.toBeVisible();
  await expect.poll(count).toBe(1);
  for (const scale of ['0.5', '1.5', '1']) {
    await page.keyboard.press('Control+,'); const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('tab', { name: 'Appearance', exact: true }).click(); await settings.getByLabel('UI Scale', { exact: true }).selectOption(scale);
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await upload([{ name: 'Cancelled.txt', text: 'A cancelled file at scale '+scale }]);
    await expect(progress).toContainText('Reading Cancelled.txt');
    expect(await progress.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1; })).toBe(true);
    await page.keyboard.press('Escape'); await expect(progress).not.toBeVisible();
    await expect(editor).toContainText('The existing document remains available.'); await expect.poll(count).toBe(1);
  }
  report.checks.push('Escape retains the current document at 50/100/150% UI scale.');
  await upload([{ name: 'First.txt', text: 'The first imported file succeeds.' }, { name: 'Second.txt', text: 'The second imported file is cancelled.' }, { name: 'Third.txt', text: 'The third file must never be imported.' }]);
  await expect(progress).toContainText('Reading Second.txt (2 of 3)');
  await page.keyboard.press('Escape'); await expect(progress).not.toBeVisible();
  await expect(editor).toContainText('The first imported file succeeds.'); await expect.poll(count).toBe(2);
  report.checks.push('Cancelling a multi-file batch keeps its earlier success and skips later files.');
  await upload([{ name: 'Broken.docx', text: 'Not a ZIP archive.' }]);
  await expect(progress).not.toBeVisible();
  await expect.poll(count).toBe(2); await expect(editor).toContainText('The first imported file succeeds.');
  await expect(page.getByRole('alert').first()).toBeVisible();
  const jobs = await app.evaluate(() => [...globalThis.openingJobs]);
  report.jobs = await page.evaluate(async jobs => Promise.all(jobs.map(async ([id, name]) => ({ name, ...(await window.alder.request('GET', `/api/document-open-jobs/${id}`)) }))), jobs);
  expect(report.jobs.filter(job => job.name === 'Cancelled.txt' || job.name === 'Second.txt').every(job => job.status === 'cancelled')).toBe(true);
  expect(report.jobs.some(job => job.name === 'Third.txt')).toBe(false);
  expect(report.jobs.find(job => job.name === 'Broken.docx')?.status).toBe('failed');
  const state = await page.evaluate(async () => (await window.alder.request('GET', '/api/projects')).projects);
  for (const item of state) {
    const versions = await page.evaluate(id => window.alder.request('GET', `/api/projects/${id}/versions`), item.id);
    expect(versions).toHaveLength(1);
  }
  report.checks.push('Broken input leaves no blank workspace; successful imports have one initial saved revision.');
  const archive = path.join(profile, 'Cancelled.alder'), first = state.find(item => item.name === 'First');
  await page.evaluate(({ id, path }) => window.alder.request('POST', `/api/projects/${id}/save`, { path }), { id: first.id, path: archive });
  await page.locator('input[aria-label="Open documents"]').setInputFiles(archive);
  await expect(progress).toContainText('Reading Cancelled.alder');
  await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(progress).not.toBeVisible(); await expect.poll(count).toBe(2);
  await app.evaluate(() => globalThis.holdOpening.delete('Cancelled.alder'));
  await page.locator('input[aria-label="Open documents"]').setInputFiles(archive);
  await expect(progress).not.toBeVisible(); await expect.poll(count).toBe(2);
  await expect(editor).toContainText('The first imported file succeeds.');
  const archiveBefore = fs.readFileSync(archive);
  await editor.fill('Saved back to the collected archive.'); await editor.press('Control+s');
  await expect.poll(() => !fs.readFileSync(archive).equals(archiveBefore)).toBe(true);
  const savedArchive = await page.evaluate(path => window.alder.request('POST', '/api/projects/open', { path }), archive);
  expect(savedArchive.book.chapters[0].document.content[0].content[0].text).toBe('Saved back to the collected archive.');
  report.checks.push('Collected archives support Cancel and reopen an identical snapshot with its native file binding.');
  const source = path.join(profile, 'Bound source.txt'); fs.writeFileSync(source, 'An imported file keeps its native identity.');
  await page.locator('input[aria-label="Open documents"]').setInputFiles(source);
  await expect(editor).toHaveText('An imported file keeps its native identity.');
  await editor.fill('Saved through the original file binding.'); await editor.press('Control+s');
  await expect.poll(() => fs.readFileSync(source, 'utf8')).toBe('Saved through the original file binding.');
  fs.writeFileSync(source, 'Changed outside Alder.');
  await editor.fill('A local edit that must be preserved.'); await editor.press('Control+s');
  await expect(page.getByRole('alert').filter({ hasText: 'changed outside Alder' })).toBeVisible();
  expect(fs.readFileSync(source, 'utf8')).toBe('Changed outside Alder.');
  await expect(editor).toHaveText('A local edit that must be preserved.');
  report.checks.push('Staged imports retain native Save and external-change protection.');
  expect(report.errors).toEqual([]); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack || error); process.exitCode = 1; await page?.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {}); }
finally { fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); await app?.close().catch(() => {}); }
