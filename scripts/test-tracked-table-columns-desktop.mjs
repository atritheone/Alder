import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const deletion=process.argv.includes('--delete');
const directory=path.resolve('work',deletion?'tracked-column-deletion-ui':'tracked-column-insertion-ui');
fs.mkdirSync(directory,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-column-review-'));
const report={status:'running',errors:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.getByRole('button',{name:'New',exact:true}).click();
  await page.getByRole('button',{name:'Word Document',exact:false}).click();
  await page.getByLabel('Name',{exact:true}).fill('Tracked table columns');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(1440,1000);w.show();w.focus();});
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true});
  const menu=async label=>{await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();};
  const dialog=page.getByRole('dialog',{name:'Review changes',exact:true});
  const open=()=>menu('Review changes…'),close=()=>dialog.getByRole('button',{name:'Done',exact:true}).click();
  await editor.click();await editor.evaluate(el=>{const data=new DataTransfer();data.setData('text/html','<table><tbody>'+['First','Middle','Last'].map(t=>`<tr><td><p><strong>${t} left</strong></p></td><td><p>${t} middle</p></td><td><p>${t} right</p></td></tr>`).join('')+'</tbody></table><p>After table.</p>');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
  const table=editor.locator('table'),rows=table.locator('tr'),pending=table.locator('td[data-revision-block]');
  await expect(rows).toHaveCount(3);const original=await editor.textContent();
  const geometry=()=>rows.evaluateAll(rows=>rows.map(row=>Array.from(row.cells).map(cell=>Math.round(cell.getBoundingClientRect().width*100)/100)));
  const before=await geometry();
  await open();await dialog.getByLabel('Review author',{exact:true}).fill('Reviewer');await dialog.getByLabel('Track changes',{exact:true}).check();await close();
  await rows.first().locator('td').nth(deletion?1:0).click();await menu(deletion?'Delete column':'Insert column right');
  await expect(pending).toHaveCount(3);await expect(rows.first().locator('td')).toHaveCount(deletion?3:4);
  if(!deletion){
    await pending.first().click();await page.keyboard.type('Added first');await expect(pending.first()).toHaveText('Added first');
    await pending.last().click();await page.keyboard.type('Added last');await expect(pending.last()).toHaveText('Added last');
    await menu('Delete column');await expect(pending).toHaveCount(0);await expect(editor).toHaveText(original);
    await editor.press('Control+z');await expect(pending).toHaveCount(3);await expect(pending.last()).toHaveText('Added last');
  }
  await open();await expect(dialog.locator('.review-list button')).toHaveCount(1);
  await dialog.getByLabel('Review preview',{exact:true}).selectOption('original');await expect(dialog.getByLabel('original document preview',{exact:true})).toHaveText(original);
  await dialog.getByLabel('Review preview',{exact:true}).selectOption('final');const final=await dialog.getByLabel('final document preview',{exact:true}).textContent();
  if(deletion)expect(final).not.toContain('First middle');else expect(final).toContain('Added first');await close();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const saved=await page.evaluate(async()=>{const projects=await window.alder.request('GET','/api/projects');return window.alder.request('GET',`/api/projects/${projects.projects[0].id}`);});
  fs.writeFileSync(path.join(directory,'fixture-project.json'),JSON.stringify(saved));
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'Tracked table columns'}).click();await expect(pending).toHaveCount(3);
  for(const scale of ['0.5','1.5','1']){
    await page.keyboard.press('Control+,');const settings=page.getByRole('dialog',{name:'Settings',exact:true});await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(scale);await settings.getByRole('button',{name:'Close settings',exact:true}).click();
    await open();expect(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})).toBe(true);await close();
  }
  await page.screenshot({path:path.join(directory,'pending-column.png')});
  await open();await dialog.getByRole('button',{name:'Reject',exact:true}).click();await close();await expect(pending).toHaveCount(0);await expect(editor).toHaveText(original);expect(await geometry()).toEqual(before);
  await editor.press('Control+z');await expect(pending).toHaveCount(3);
  await open();await dialog.getByRole('button',{name:'Accept',exact:true}).click();await close();await expect(pending).toHaveCount(0);await expect(editor).toHaveText(final);await expect(rows.first().locator('td')).toHaveCount(deletion?2:4);
  await editor.press('Control+z');await expect(pending).toHaveCount(3);await editor.press('Control+y');await expect(pending).toHaveCount(0);await expect(editor).toHaveText(final);
  expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);process.exitCode=1;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));if(report.status==='failed')await app?.evaluate(({app})=>app.exit(1)).catch(()=>{});await app?.close().catch(()=>{});}
