import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const deletion=process.argv.includes('--delete');
const split=process.argv.includes('--split'),replacement=process.argv.includes('--replace');
const directory=path.resolve(`work/tracked-whole-table-${deletion?'deletion':'insertion'}-ui${split?replacement?'-replace':'-split':''}`);
fs.mkdirSync(directory,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-table-review-'));
const report={status:'running',errors:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.getByRole('button',{name:'New',exact:true}).click();await page.getByRole('button',{name:'Word Document',exact:false}).click();
  await page.getByLabel('Name',{exact:true}).fill('Whole table review');await page.getByRole('button',{name:'Create',exact:true}).click();
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(1440,1000);w.show();w.focus();});
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true}),table=editor.locator('table'),rows=table.locator('tr');
  const menu=async label=>{await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();};
  const dialog=page.getByRole('dialog',{name:'Review changes',exact:true});
  const open=()=>menu('Review changes…'),close=()=>dialog.getByRole('button',{name:'Done',exact:true}).click();
  const insert=async()=>{
    await menu('Insert table…');const insert=page.getByRole('dialog',{name:'Insert table',exact:true});
    await insert.getByLabel('Table rows',{exact:true}).fill('2');await insert.getByLabel('Table columns',{exact:true}).fill('2');
    await insert.getByRole('button',{name:'Insert',exact:true}).click();await expect(table).toHaveCount(1);
    await table.locator('td').first().click();await page.keyboard.type('First cell.');
    await table.locator('td').last().click();await page.keyboard.type('Last cell.');
  };
  await editor.click();if(deletion)await insert();
  if(split){
    await page.keyboard.type(replacement?'Before selected words':'Before after.');
    if(replacement){await page.keyboard.press('Enter');await page.keyboard.type('More removed after.');}
    await editor.evaluate((el,replacement)=>{
      el.focus();const paragraphs=el.querySelectorAll('p'),range=document.createRange();
      range.setStart(paragraphs[0].firstChild,7);
      range.setEnd(replacement?paragraphs[1].firstChild:paragraphs[0].firstChild,replacement?13:7);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
    },replacement);
  }
  const original=await editor.textContent();
  await open();await dialog.getByLabel('Review author',{exact:true}).fill('Reviewer');await dialog.getByLabel('Track changes',{exact:true}).check();await close();
  if(deletion){await table.locator('td').first().click();await menu('Delete table');}
  else{
    await insert();await menu('Insert row below');await expect(rows).toHaveCount(3);
    await table.locator('td').first().click();await menu('Delete table');await expect(table).toHaveCount(0);
    await editor.press('Control+z');await expect(table).toHaveCount(1);await expect(rows).toHaveCount(3);
  }
  await expect(table).toHaveAttribute('data-revision-block-kind',deletion?'deletion':'insertion');
  const range=await table.evaluate(el=>{const first=el.querySelector('p'),last=el.querySelector('tr:last-child td:last-child p');return {start:!!first,end:!!last};});expect(range).toEqual({start:true,end:true});
  await editor.evaluate(el=>{el.focus();const table=el.querySelector('table'),first=table.querySelector('p'),last=table.querySelector('tr:last-child td:last-child p');const r=document.createRange();r.setStart(first,0);r.setEnd(last,last.childNodes.length);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));});
  await menu('Comments…');const comments=page.getByRole('dialog',{name:'Comments',exact:true});
  await comments.getByLabel('Comment author',{exact:true}).fill('Reader');await comments.getByLabel('Comment text',{exact:true}).fill('Review this whole table.');await comments.getByRole('button',{name:'Add comment',exact:true}).click();
  await expect(editor.locator('[data-comment-thread]')).toHaveCount(2);
  await open();await expect(dialog.locator('.review-list button')).toHaveCount(1);
  await dialog.getByLabel('Review preview',{exact:true}).selectOption('original');await expect(dialog.getByLabel('original document preview',{exact:true})).toHaveText(original);
  await dialog.getByLabel('Review preview',{exact:true}).selectOption('final');const final=await dialog.getByLabel('final document preview',{exact:true}).textContent();await close();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const exported=await page.evaluate(async()=>{const projects=await window.alder.request('GET','/api/projects');const source=await window.alder.request('GET',`/api/projects/${projects.projects[0].id}`);const result=await window.alder.request('POST',`/api/projects/${source.id}/export`,{format:'docx'});const response=await fetch(window.alder.mediaBase+result.downloadUrl);return{source,result,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};});
  const file=path.join(directory,'alder.docx');fs.writeFileSync(file,Buffer.from(exported.bytes));fs.writeFileSync(path.join(directory,'fixture-project.json'),JSON.stringify(exported.source));fs.writeFileSync(path.join(directory,'fixture-exports.json'),JSON.stringify({docx:{...exported.result,path:file},reviewDecisions:true,skipListNumbers:true,expectedText:['First cell.','Last cell.']}));
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'Whole table review'}).click();await expect(table).toHaveAttribute('data-revision-block-kind',deletion?'deletion':'insertion');
  for(const scale of ['0.5','1.5','1']){
    await page.keyboard.press('Control+,');const settings=page.getByRole('dialog',{name:'Settings',exact:true});await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(scale);await settings.getByRole('button',{name:'Close settings',exact:true}).click();
    await open();expect(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})).toBe(true);await close();
  }
  await page.screenshot({path:path.join(directory,'pending-table.png')});
  for(const decision of ['Reject','Accept']){
    await open();await dialog.getByRole('button',{name:decision,exact:true}).click();await close();
    await expect(editor).toHaveText(decision==='Reject'?original:final);
    const survives=deletion===(decision==='Reject');await expect(table).toHaveCount(survives?1:0);await expect(editor.locator('[data-comment-thread]')).toHaveCount(survives?2:0);
    await editor.press('Control+z');await expect(table).toHaveAttribute('data-revision-block-kind',deletion?'deletion':'insertion');
  }
  expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));if(report.status==='failed')await app?.evaluate(({app})=>app.exit(1)).catch(()=>{});await app?.close().catch(()=>{});}
