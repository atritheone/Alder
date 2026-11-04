import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const merged=process.argv.includes('--merged'),up=process.argv.includes('--up');
const directory=path.resolve(`work/tracked-row-moves-${up?'up':'down'}-ui${merged?'-merged':''}`);
fs.mkdirSync(directory,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-row-moves-'));
const report={status:'running',errors:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.getByRole('button',{name:'New',exact:true}).click();await page.getByRole('button',{name:'Word Document',exact:false}).click();
  await page.getByLabel('Name',{exact:true}).fill('Tracked row moves');await page.getByRole('button',{name:'Create',exact:true}).click();
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(1440,1000);w.show();w.focus();});
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true});
  const menu=async label=>{await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();};
  const review=page.getByRole('dialog',{name:'Review changes',exact:true});
  const open=()=>menu('Review changes…'),close=()=>review.getByRole('button',{name:'Done',exact:true}).click();
  await editor.click();await editor.evaluate(el=>{const data=new DataTransfer();data.setData('text/html','<table><tbody>'+['First','Middle','Other','Last'].map(t=>`<tr><td><p><strong>${t} left</strong></p></td><td><p>${t} right</p></td></tr>`).join('')+'</tbody></table><p>After table.</p>');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
  const table=editor.locator('table'),rows=table.locator('tr'),pending=table.locator('tr[data-revision-block-move]');
  await expect(rows).toHaveCount(4);
  if(merged){await rows.nth(1).locator('td').first().click();await rows.nth(2).locator('td').first().click({modifiers:['Shift']});await menu('Merge cells');await expect(rows.nth(1).locator('td').first()).toHaveAttribute('rowspan','2');}
  const original=await editor.textContent();
  await editor.evaluate((el,merged)=>{el.focus();const rows=el.querySelectorAll('tr'),first=rows[1].querySelector('p'),last=rows[merged?2:1].querySelector('td:last-child p'),range=document.createRange();range.setStart(first,0);range.setEnd(last,last.childNodes.length);const s=getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new Event('selectionchange'));},merged);
  await menu('Comments…');const comments=page.getByRole('dialog',{name:'Comments',exact:true});
  await comments.getByLabel('Comment author',{exact:true}).fill('Reader');await comments.getByLabel('Comment text',{exact:true}).fill('Keep this comment with the rows.');await comments.getByRole('button',{name:'Add comment',exact:true}).click();
  await open();await review.getByLabel('Review author',{exact:true}).fill('Reviewer');await review.getByLabel('Track changes',{exact:true}).check();await close();
  await rows.nth(1).locator('td').first().click();await menu(up?'Move rows up':'Move rows down');
  await expect(pending).toHaveCount(merged?4:2);await expect(editor.locator('[data-comment-thread]')).toHaveCount(4);
  await menu('Comments…');await expect(comments.getByRole('listitem')).toHaveCount(1);await expect(comments).not.toContainText('Anchor incomplete');await comments.getByRole('button',{name:'Close',exact:true}).click();
  await open();await expect(review.locator('.review-list button')).toHaveCount(1);
  await review.getByLabel('Review preview',{exact:true}).selectOption('original');await expect(review.getByLabel('original document preview',{exact:true})).toHaveText(original);
  await review.getByLabel('Review preview',{exact:true}).selectOption('final');const final=await review.getByLabel('final document preview',{exact:true}).textContent();
  expect(final.indexOf('Middle left')<final.indexOf('First left')).toBe(up);
  if(!up)expect(final.indexOf(merged?'Last left':'Other left')<final.indexOf('Middle left')).toBe(true);await close();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const exported=await page.evaluate(async()=>{const projects=await window.alder.request('GET','/api/projects');const source=await window.alder.request('GET',`/api/projects/${projects.projects[0].id}`);const result=await window.alder.request('POST',`/api/projects/${source.id}/export`,{format:'docx'});const response=await fetch(window.alder.mediaBase+result.downloadUrl);return{source,result,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};});
  const file=path.join(directory,'alder.docx');fs.writeFileSync(file,Buffer.from(exported.bytes));fs.writeFileSync(path.join(directory,'fixture-project.json'),JSON.stringify(exported.source));fs.writeFileSync(path.join(directory,'fixture-exports.json'),JSON.stringify({docx:{...exported.result,path:file},reviewDecisions:true,skipListNumbers:true,expectedText:['After table.']}));
  await editor.press('Control+z');await expect(pending).toHaveCount(0);await expect(editor).toHaveText(original);await editor.press('Control+y');await expect(pending).toHaveCount(merged?4:2);
  await expect(page.locator('.save-status')).toHaveText('Saved');await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'Tracked row moves'}).click();await expect(pending).toHaveCount(merged?4:2);
  for(const scale of ['0.5','1.5','1']){
    await page.keyboard.press('Control+,');const settings=page.getByRole('dialog',{name:'Settings',exact:true});await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(scale);await settings.getByRole('button',{name:'Close settings',exact:true}).click();
    await open();expect(await review.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})).toBe(true);await close();
  }
  await page.screenshot({path:path.join(directory,'pending-row-move.png')});
  for(const decision of ['Reject','Accept']){
    await open();await review.getByRole('button',{name:decision,exact:true}).click();await close();await expect(pending).toHaveCount(0);await expect(rows).toHaveCount(4);await expect(editor).toHaveText(decision==='Reject'?original:final);await expect(editor.locator('[data-comment-thread]')).toHaveCount(2);
    await editor.press('Control+z');await expect(pending).toHaveCount(merged?4:2);
  }
  expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);process.exitCode=1;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));if(report.status==='failed')await app?.evaluate(({app})=>app.exit(1)).catch(()=>{});await app?.close().catch(()=>{});}
