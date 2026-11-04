import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const deletion=process.argv.includes('--delete');
const merged=process.argv.includes('--merged');
const grouped=merged||process.argv.includes('--group'),expected=grouped?2:1;
const comments=process.argv.includes('--comments');
const directory=path.resolve('work',(grouped?(deletion?'tracked-row-group-deletion-ui':'tracked-row-group-insertion-ui'):(deletion?'tracked-row-deletion-ui':'tracked-row-insertion-ui'))+(comments?'-comments':'')+(merged?'-merged':''));
fs.mkdirSync(directory,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-row-review-'));
const report={status:'running',errors:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.getByRole('button',{name:'New',exact:true}).click();
  await page.getByRole('button',{name:'Word Document',exact:false}).click();
  await page.getByLabel('Name',{exact:true}).fill('Tracked table rows');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(1440,1000);w.show();w.focus();});
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true});
  const menu=async label=>{await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();};
  const dialog=page.getByRole('dialog',{name:'Review changes',exact:true});
  const open=()=>menu('Review changes…'),close=()=>dialog.getByRole('button',{name:'Done',exact:true}).click();
  await editor.click();await editor.evaluate((el,grouped)=>{const data=new DataTransfer();data.setData('text/html','<table><tbody>'+(grouped?['First','Middle','Other','Last']:['First','Middle','Last']).map(t=>`<tr><td><p><strong>${t} left</strong></p></td><td><p>${t} right</p></td></tr>`).join('')+'</tbody></table><p>After table.</p>');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));},grouped);
  const table=editor.locator('table'),rows=table.locator('tr'),pending=table.locator('tr[data-revision-block]');
  await expect(rows).toHaveCount(grouped?4:3);
  if(merged&&deletion){
    await rows.nth(1).locator('td').first().click();await rows.nth(2).locator('td').first().click({modifiers:['Shift']});await menu('Merge cells');
    await expect(rows.nth(1).locator('td').first()).toHaveAttribute('rowspan','2');
  }
  const original=await editor.textContent();
  const commentDialog=page.getByRole('dialog',{name:'Comments',exact:true});
  const annotate=async(first,last)=>{
    await editor.evaluate((el,{first,last})=>{
      el.focus();const rows=el.querySelectorAll('tr'),start=rows[first].querySelector('p'),end=rows[last].querySelector('td:last-child p');
      const range=document.createRange();range.setStart(start,0);range.setEnd(end,end.childNodes.length);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
    },{first,last});
    await menu('Comments…');await commentDialog.getByLabel('Comment author',{exact:true}).fill('Reader');await commentDialog.getByLabel('Comment text',{exact:true}).fill('Check these rows.');
    await commentDialog.getByRole('button',{name:'Add comment',exact:true}).click();await expect(editor.locator('[data-comment-thread]')).toHaveCount(2);
  };
  const checkComments=async present=>{
    if(!comments)return;
    await expect(editor.locator('[data-comment-thread]')).toHaveCount(present?2:0);
    await menu('Comments…');await expect(commentDialog.getByRole('listitem')).toHaveCount(present?1:0);await expect(commentDialog).not.toContainText('Anchor incomplete');
    await commentDialog.getByRole('button',{name:'Close',exact:true}).click();
  };
  if(comments&&deletion)await annotate(1,grouped?2:1);
  await open();await dialog.getByLabel('Review author',{exact:true}).fill('Reviewer');await dialog.getByLabel('Track changes',{exact:true}).check();await close();
  await rows.nth(1).locator('td').first().click();
  if(grouped){await rows.nth(2).locator('td').last().click({modifiers:['Shift']});await expect(table.locator('.selectedCell')).toHaveCount(merged&&deletion?3:4);}
  await menu(deletion?'Delete row':'Insert row below');
  await expect(pending).toHaveCount(expected);await expect(rows).toHaveCount((grouped?4:3)+(deletion?0:expected));
  if(!deletion){
    await pending.first().locator('td').first().click();await page.keyboard.type('Added left');await expect(pending.first().locator('td').first()).toHaveText('Added left');
    await pending.first().locator('td').nth(1).click();await page.keyboard.type('Added right');await expect(pending.first()).toHaveText('Added leftAdded right');
    await menu('Delete row');await expect(pending).toHaveCount(expected-1);if(!grouped)await expect(editor).toHaveText(original);
    await editor.press('Control+z');await expect(pending).toHaveCount(expected);await expect(pending.first()).toHaveText('Added leftAdded right');
    if(grouped){await pending.last().locator('td').first().click();await page.keyboard.type('Second added row');}
    if(merged){
      await pending.first().locator('td').first().click();await pending.last().locator('td').first().click({modifiers:['Shift']});await menu('Merge cells');
      await expect(pending.first().locator('td').first()).toHaveAttribute('rowspan','2');await expect(pending.last().locator('td')).toHaveCount(1);
    }
    if(comments)await annotate(grouped?3:2,grouped?4:2);
  }
  await checkComments(true);
  await open();await expect(dialog.locator('.review-list button')).toHaveCount(1);
  await dialog.getByLabel('Review preview',{exact:true}).selectOption('original');await expect(dialog.getByLabel('original document preview',{exact:true})).toHaveText(original);
  await dialog.getByLabel('Review preview',{exact:true}).selectOption('final');const final=await dialog.getByLabel('final document preview',{exact:true}).textContent();
  expect(final).toContain(deletion?'Last left':'Added left');if(deletion)expect(final).not.toContain('Middle left');await close();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const exported=await page.evaluate(async()=>{const projects=await window.alder.request('GET','/api/projects');const source=await window.alder.request('GET',`/api/projects/${projects.projects[0].id}`);const result=await window.alder.request('POST',`/api/projects/${source.id}/export`,{format:'docx'});const response=await fetch(window.alder.mediaBase+result.downloadUrl);return{source,result,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};});
  const file=path.join(directory,'alder.docx');fs.writeFileSync(file,Buffer.from(exported.bytes));fs.writeFileSync(path.join(directory,'fixture-project.json'),JSON.stringify(exported.source));
  fs.writeFileSync(path.join(directory,'fixture-exports.json'),JSON.stringify({docx:{...exported.result,path:file},reviewDecisions:true,skipListNumbers:true,expectedText:['After table.']}));
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'Tracked table rows'}).click();await expect(pending).toHaveCount(expected);
  for(const scale of ['0.5','1.5','1']){
    await page.keyboard.press('Control+,');const settings=page.getByRole('dialog',{name:'Settings',exact:true});await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(scale);await settings.getByRole('button',{name:'Close settings',exact:true}).click();
    await open();expect(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})).toBe(true);await close();
  }
  await page.screenshot({path:path.join(directory,'pending-row.png')});
  await open();await dialog.getByRole('button',{name:'Reject',exact:true}).click();await close();await expect(pending).toHaveCount(0);await expect(editor).toHaveText(original);
  await checkComments(deletion);
  await editor.press('Control+z');await expect(pending).toHaveCount(expected);await open();await dialog.getByRole('button',{name:'Accept',exact:true}).click();await close();await expect(pending).toHaveCount(0);await expect(editor).toHaveText(final);
  await checkComments(!deletion);
  await editor.press('Control+z');await expect(pending).toHaveCount(expected);await editor.press('Control+y');await expect(pending).toHaveCount(0);await expect(editor).toHaveText(final);
  expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);process.exitCode=1;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));if(report.status==='failed')await app?.evaluate(({app})=>app.exit(1)).catch(()=>{});await app?.close().catch(()=>{});}
