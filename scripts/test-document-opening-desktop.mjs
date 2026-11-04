// Real saved-document opening and caret geometry; use an isolated desktop/profile.
import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const paragraphs = Number(process.env.ALDER_OPEN_PARAGRAPHS || 4000);
const hyphenation = process.env.ALDER_OPEN_HYPHENATION !== '0';
if (!Number.isInteger(paragraphs) || paragraphs < 40 || paragraphs > 4000) throw Error('Choose 40–4000 paragraphs.');
const directory = path.resolve(`work/document-opening-${paragraphs}${hyphenation ? '-hyphenation' : ''}`);
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'alder-document-opening-'));
const report = { status: 'running', paragraphs, hyphenation, errors: [], caret: [],
  machine: { platform: process.platform, cpu: os.cpus()[0]?.model, font: 'Cambria', measuredAt: new Date().toISOString() } };
let app, page;
try {
  app = await electron.launch({ executablePath: desktopExecutable(), args: ['.', '--headless-test', `--user-data-dir=${profile}/profile`], env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` } });
  page = await app.firstWindow(); page.setDefaultTimeout(120000);
  page.on('pageerror', error => report.errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 1000); w.show(); w.focus(); });
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
  const id = await page.evaluate(async ({ paragraphs, hyphenation }) => {
    const p = await window.alder.request('POST', '/api/projects', { name: 'Document opening benchmark', template: 'blank' });
    Object.assign(p.settings, { documentKind: 'docx', includeTitle: false, includeToc: false, fontFamily: 'Cambria', fontSize: 12 });
    const subjects = ['A painter', 'The gardener', 'A musician', 'The writer', 'A traveller', 'The librarian', 'A teacher', 'The visitor'];
    const actions = ['studies the colours', 'notices the changing light', 'remembers an old conversation', 'listens to the birds', 'watches the distant boats', 'examines the folded map', 'reads a letter', 'considers the journey'];
    const places = ['beside the river', 'under the tall trees', 'near the harbour', 'outside the village', 'at the garden gate', 'inside the quiet house', 'beyond the stone bridge', 'on the shaded path'];
    p.book = { version: 1, chapters: [{ id: 'opening', title: 'Document', include: true, document: { type: 'doc', content: Array.from({ length: paragraphs }, (_, i) => ({
      type: 'paragraph', attrs: { blockId: `opening-${i}`, ...(hyphenation ? { hyphenation: true } : {}) }, content: [{ type: 'text', text: `Paragraph ${i + 1}. ` + Array.from({ length: 4 }, (_, part) => {
        const n = i * 4 + part;
        return `${subjects[n % 8]} ${actions[Math.floor(n / 8) % 8]} ${places[Math.floor(n / 64) % 8]}. ${subjects[(n + 3) % 8]} ${actions[Math.floor((n + 17) / 8) % 8]} ${places[Math.floor((n + 73) / 64) % 8]}, taking a moment to notice the details of the unfamiliar surroundings. `;
      }).join('') }],
    })) } }] };
    await window.alder.request('PUT', `/api/projects/${p.id}`, { project: p, expectedRevision: p.revision });
    return p.id;
  }, { paragraphs, hyphenation });
  await page.reload(); await page.getByRole('button', { name: 'Open', exact: true }).click();
  const profiler = process.env.ALDER_OPEN_PROFILE === '1' ? await page.context().newCDPSession(page) : null;
  if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
  const start = performance.now();
  await page.locator('.project-list-item').filter({ hasText: 'Document opening benchmark' }).click();
  const editor = page.getByRole('textbox', { name: 'Chapter text editor', exact: true });
  await expect(editor).toBeVisible();
  await expect.poll(() => page.locator('.book-editor .page-sheet').count(), { timeout: 120000 }).toBeGreaterThan(Math.floor(paragraphs / 5));
  report.openMilliseconds = performance.now() - start;
  report.pages = await page.locator('.book-editor .page-sheet').count();
  if (profiler) {
    fs.writeFileSync(path.join(directory, 'cpu.json'), JSON.stringify((await profiler.send('Profiler.stop')).profile));
    await profiler.detach();
  }
  report.authoredTextIntact = await editor.evaluate(async (element, id) => {
    const project = await window.alder.request('GET', `/api/projects/${id}`);
    const expected = project.book.chapters[0].document.content.map(node => node.content.map(child => child.text || '').join(''));
    const actual = [...element.children].filter(node => node.tagName === 'P').map(node => {
      const copy = node.cloneNode(true); copy.querySelectorAll('.ProseMirror-widget').forEach(widget => widget.remove()); return copy.textContent;
    });
    return JSON.stringify(actual) === JSON.stringify(expected);
  }, id);
  expect(report.authoredTextIntact).toBe(true);
  for (const index of [0, Math.floor(paragraphs / 2), paragraphs - 1]) {
    const paragraph = editor.locator(':scope > p').nth(index);
    await paragraph.scrollIntoViewIfNeeded(); await paragraph.click({ position: { x: 35, y: 10 } });
    await page.keyboard.press('ArrowRight');
    let geometry;
    await expect.poll(async () => {
      geometry = await editor.evaluate(element => {
        const selection = document.getSelection();
        if (!selection?.isCollapsed || !selection.rangeCount || !element.contains(selection.focusNode)) return { valid: false, error: Infinity };
        const native = selection.getRangeAt(0).getBoundingClientRect(), caret = element.parentElement.querySelector('.write-caret');
        if (!caret || caret.hidden) return { valid: false, error: Infinity };
        const painted = caret.getBoundingClientRect();
        return { valid: true, error: Math.max(Math.abs(native.x - painted.x), Math.abs(native.y - painted.y)) };
      });
      return geometry.error;
    }, { timeout: 10000 }).toBeLessThan(1);
    report.caret.push({ paragraph: index + 1, ...geometry });
  }
  expect(report.errors).toEqual([]); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack || error); process.exitCode = 1; }
finally { fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); await app?.close().catch(() => {}); }
