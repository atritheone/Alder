import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const directory = path.resolve('work/integer-counts'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'alder-integer-counts-'));
fs.mkdirSync(directory, {recursive:true});
const report = {status:'running', errors:[]}; let app, page;
try {
  app = await electron.launch({executablePath:desktopExecutable(), args:['.', '--headless-test', `--user-data-dir=${profile}/profile`], env:{...process.env, ALDER_DATA_DIR:`${profile}/data`}});
  page = await app.firstWindow(); page.on('pageerror', e => report.errors.push(e.message));
  await expect(page.getByRole('button', {name:'New', exact:true})).toBeVisible();
  await page.evaluate(async () => {
    const p = await window.alder.request('POST', '/api/projects', {name:'Integer counts', template:'blank'});
    Object.assign(p.settings, {documentKind:'docx', includeTitle:false, includeToc:false});
    const content = [];
    for (let i=0;i<1001;i++) {
      if(i) content.push({type:'page_break'});
      const thread={resolved:false,entries:[{id:`entry_${i}`,author:'Reader',text:'Check wording.',date:'2026-11-04T00:00:00Z'}]};
      const anchor=edge=>({type:'comment_anchor',attrs:{threadId:`thread_${i}`,edge,thread}});
      content.push({type:'paragraph',content:[anchor('start'),{type:'text',text:i<233?'Hello world.':'Hello.',marks:[{type:'revision_insertion',attrs:{id:`change_${i}`,author:'Reviewer',date:''}}]},anchor('end')]});
    }
    p.book={version:1,chapters:[{id:'counts',title:'Document',include:true,document:{type:'doc',content}}]};
    await window.alder.request('PUT', `/api/projects/${p.id}`, {project:p,expectedRevision:p.revision});
  });
  await page.reload(); await page.getByRole('button',{name:'Open',exact:true}).click();
  await page.locator('.project-list-item').filter({hasText:'Integer counts'}).click();
  const write=page.getByRole('textbox',{name:'Chapter text editor',exact:true});
  await expect(write).toBeVisible({timeout:60000});
  await expect(page.locator('.writing-word-count')).toHaveText('1,234 Words');
  await expect(page.locator('.writing-sentence-count')).toContainText('1,001 Sentences');
  await expect(page.locator('.page-navigation')).toContainText('of 1,001',{timeout:60000});
  const navigation=page.getByRole('spinbutton',{name:'Go To Page'});
  await navigation.fill('1,000'); await navigation.press('Enter');
  await expect(navigation).toHaveValue('1,000'); await expect(navigation).toHaveAttribute('aria-valuenow','1000');
  await navigation.press('ArrowUp'); await navigation.press('Enter'); await expect(navigation).toHaveValue('1,001');
  await navigation.press('ArrowDown'); await expect(navigation).toHaveValue('1,000');
  await write.press('Control+A');
  await expect(page.locator('.selection-page-count')).toHaveText('1,001 Pages');
  const toggle=page.getByRole('button',{name:'Toggle sandbox',exact:true});
  if(await toggle.getAttribute('aria-expanded')==='false') await toggle.click();
  await page.locator('.detail-heading').getByRole('tab',{name:'Sandbox',exact:true}).click();
  const sandbox=page.getByRole('textbox',{name:'Sandbox text editor',exact:true});
  await sandbox.fill('One. '.repeat(1000).trim());
  await expect(page.locator('.clip-properties .property-grid output')).toHaveText(['1,000','1,000']);
  await sandbox.press('Control+A');
  await expect(page.locator('.clip-properties .property-grid output')).toHaveText(['1,000','1,000']);
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu().items.flatMap(menu => menu.submenu?.items || []).find(item => item.label.startsWith('Export'));
    if (!item) throw Error('Export menu command was not found.');
    const window = BrowserWindow.getAllWindows()[0];
    Reflect.apply(item.click, item, [{ triggeredByAccelerator: false }, window, window.webContents]);
  });
  await expect(page.locator('.export-summary')).toContainText('1,234 words');
  await expect(page.locator('.export-review-summary')).toContainText('1,001 unresolved comment threads');
  await expect(page.locator('.export-review-summary')).toContainText('1,001 pending changes');
  await page.screenshot({path:path.join(directory,'counts.png')});
  expect(report.errors).toEqual([]); report.status='passed';
} catch(error) {report.status='failed';report.error=error.stack;throw error;}
finally {fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));await app?.close();}
