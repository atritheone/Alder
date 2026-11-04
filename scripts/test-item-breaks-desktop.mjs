import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const joining = process.argv.includes('--join'), originalCount = joining ? 3 : 2, finalCount = joining ? 2 : 3;
const directory = path.resolve(joining ? 'work/item-joins-ui' : 'work/item-breaks-ui'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'alder-item-break-'));
fs.mkdirSync(directory, { recursive: true });
const report = { status: 'running', errors: [] }; let app, page;
try {
  app = await electron.launch({ executablePath: desktopExecutable(), args: ['.', '--headless-test', `--user-data-dir=${profile}/profile`], env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` } });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => report.errors.push(e.message));
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'Word Document', exact: false }).click();
  await page.getByLabel('Name', { exact: true }).fill('Item boundaries'); await page.getByRole('button', { name: 'Create', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(1440, 1000); w.show(); w.focus(); });
  const editor = page.getByRole('textbox', { name: 'Chapter text editor', exact: true });
  const menu = async label => { await page.locator('.book-main .format-toolbar').getByRole('button', { name: 'More formatting', exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click(); };
  const review = page.getByRole('dialog', { name: 'Review changes', exact: true }), open = () => menu('Review changes…'), close = () => review.getByRole('button', { name: 'Done', exact: true }).click();
  await editor.click(); await editor.evaluate((el, joining) => { const data = new DataTransfer(); data.setData('text/html', '<ol start="3"><li><p>First words</p>' + (joining ? '</li><li>' : '') + '<p>Continuation</p><ul><li><p>Nested</p></li></ul></li><li><p>Last item</p></li></ol>'); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); }, joining);
  const items = editor.locator('ol').first().locator(':scope > li'), boundary = editor.locator('[data-revision-break]');
  await expect(items).toHaveCount(originalCount); const original = await editor.textContent();
  await editor.evaluate((el, joining) => { el.focus(); const item = el.querySelector('ol>li'), range = document.createRange(); range.selectNodeContents(item); if (joining) range.setEnd(item.nextElementSibling, item.nextElementSibling.childNodes.length); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); }, joining);
  await menu('Comments…'); const comments = page.getByRole('dialog', { name: 'Comments', exact: true });
  await comments.getByLabel('Comment author', { exact: true }).fill('Reader'); await comments.getByLabel('Comment text', { exact: true }).fill('Keep both halves and the nested content.'); await comments.getByRole('button', { name: 'Add comment', exact: true }).click();
  await open(); await review.getByLabel('Review author', { exact: true }).fill('Writer'); await review.getByLabel('Track changes', { exact: true }).check(); await close();
  await editor.evaluate((el, joining) => { el.focus(); const p = [...el.querySelectorAll('p')].find(p => p.textContent === (joining ? 'Continuation' : 'First words')), walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let text; while ((text = walker.nextNode())) if (text.textContent === p.textContent) break; const range = document.createRange(); range.setStart(text, joining ? 0 : 5); range.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange')); }, joining);
  await page.keyboard.press(joining ? 'Backspace' : 'Enter'); await expect(boundary).toHaveCount(1); await expect(items).toHaveCount(finalCount);
  await page.keyboard.type('added ');
  await open(); await expect(review.locator('.review-list button')).toHaveCount(2);
  await review.locator('.review-list button').filter({ hasText: 'List item break' }).click(); await review.getByRole('button', { name: 'Reject', exact: true }).click(); await close();
  await expect(items).toHaveCount(originalCount); await expect(editor.locator('p').nth(joining ? 1 : 0)).toHaveText(joining ? 'added Continuation' : 'Firstadded  words'); await expect(editor.locator('[data-revision-insertion]')).toHaveText('added ');
  await editor.press('Control+z'); await expect(boundary).toHaveCount(1); await expect(items).toHaveCount(finalCount);
  // Remove only the independent typing change, retaining the split for export.
  await open(); await review.locator('.review-list button').filter({ hasText: 'Inserted: added ' }).click(); await review.getByRole('button', { name: 'Reject', exact: true }).click();
  await review.getByLabel('Review preview', { exact: true }).selectOption('original'); await expect(review.getByLabel('original document preview', { exact: true })).toHaveText(original);
  await review.getByLabel('Review preview', { exact: true }).selectOption('final'); const final = await review.getByLabel('final document preview', { exact: true }).textContent(); await close();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const exported = await page.evaluate(async () => { const projects = await window.alder.request('GET', '/api/projects'); const source = await window.alder.request('GET', `/api/projects/${projects.projects[0].id}`); const result = await window.alder.request('POST', `/api/projects/${source.id}/export`, { format: 'docx' }); return { source, result, bytes: [...new Uint8Array(await (await fetch(window.alder.mediaBase + result.downloadUrl)).arrayBuffer())] }; });
  const file = path.join(directory, 'alder.docx'); fs.writeFileSync(file, Buffer.from(exported.bytes)); fs.writeFileSync(path.join(directory, 'fixture-project.json'), JSON.stringify(exported.source)); fs.writeFileSync(path.join(directory, 'fixture-exports.json'), JSON.stringify({ docx: { ...exported.result, path: file }, reviewDecisions: true, skipListNumbers: true, expectedText: ['First', 'Last item'] }));
  await page.reload(); await page.getByRole('button', { name: 'Open', exact: true }).click(); await page.locator('.project-list-item').filter({ hasText: 'Item boundaries' }).click(); await expect(boundary).toHaveCount(1);
  for (const scale of ['0.5', '1.5', '1']) {
    await page.keyboard.press('Control+,'); const settings = page.getByRole('dialog', { name: 'Settings', exact: true }); await settings.getByRole('tab', { name: 'Appearance', exact: true }).click(); await settings.getByLabel('UI Scale', { exact: true }).selectOption(scale); await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await open(); expect(await review.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; })).toBe(true); await close();
  }
  for (const decision of ['Reject', 'Accept']) {
    await open(); await review.getByRole('button', { name: decision, exact: true }).click(); await close(); await expect(boundary).toHaveCount(0); await expect(items).toHaveCount(decision === 'Reject' ? originalCount : finalCount); await expect(editor).toHaveText(decision === 'Reject' ? original : final);
    await expect(editor.locator('[data-comment-thread]')).toHaveCount(2); await editor.press('Control+z'); await expect(boundary).toHaveCount(1);
  }
  expect(report.errors).toEqual([]); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack || error); report.body = await page?.locator('body').innerText().catch(() => null); process.exitCode = 1; }
finally { fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); if (report.status === 'failed') await app?.evaluate(({ app }) => app.exit(1)).catch(() => {}); await app?.close().catch(() => {}); }
