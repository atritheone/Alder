import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const deletion=process.argv.includes('--delete'),enter=process.argv.includes('--enter'),whole=process.argv.includes('--whole');
const directory=path.resolve(`work/tracked-${whole?'whole-lists':'list-items'}-${deletion?'delete':enter?'enter':'insert'}-ui`);fs.mkdirSync(directory,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-item-review-'));
const report={status:'running',errors:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.getByRole('button',{name:'New',exact:true}).click();await page.getByRole('button',{name:'Word Document',exact:false}).click();await page.getByLabel('Name',{exact:true}).fill('Tracked list items');await page.getByRole('button',{name:'Create',exact:true}).click();
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(1440,1000);w.show();w.focus();});
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true});
  const menu=async label=>{await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();};
  const review=page.getByRole('dialog',{name:'Review changes',exact:true}),open=()=>menu('Review changes…'),close=()=>review.getByRole('button',{name:'Done',exact:true}).click();
  if(whole&&!deletion){await open();await review.getByLabel('Review author',{exact:true}).fill('Reviewer');await review.getByLabel('Track changes',{exact:true}).check();await close();}
  await editor.click();await editor.evaluate(el=>{const data=new DataTransfer();data.setData('text/html','<ol start="3" style="list-style-type:upper-alpha"><li><p>First item</p></li><li><p>Middle item</p><p>Continuation</p><ul><li><p>Nested item</p></li></ul><p>After nested</p></li><li><p>Last item</p></li></ol>');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
  const list=editor.locator('ol').first(),items=list.locator(':scope > li'),pending=whole?editor.locator('ol[data-revision-block]'):list.locator(':scope > li[data-revision-block]');
  await expect(items).toHaveCount(3);const original=whole&&!deletion?'':await editor.textContent();
  const position=async()=>editor.evaluate((el,{enter,whole})=>{el.focus();const item=el.querySelector('ol').children[enter?2:1],p=item.querySelector('p'),range=document.createRange();if(whole){const list=el.querySelector('ol');range.setStart(list.firstElementChild.firstElementChild,0);range.setEnd(list.lastElementChild.lastElementChild,list.lastElementChild.lastElementChild.childNodes.length);}else{range.selectNodeContents(p);range.collapse(!enter);}const s=getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new Event('selectionchange'));},{enter,whole});
  const comments=page.getByRole('dialog',{name:'Comments',exact:true});
  if(deletion){
    await editor.evaluate(el=>{el.focus();const item=el.querySelector('ol').children[1],range=document.createRange();range.setStart(item.firstElementChild,0);range.setEnd(item.lastElementChild,item.lastElementChild.childNodes.length);const s=getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
    await menu('Comments…');await comments.getByLabel('Comment author',{exact:true}).fill('Reader');await comments.getByLabel('Comment text',{exact:true}).fill('Keep the complete item.');await comments.getByRole('button',{name:'Add comment',exact:true}).click();
  }
  await open();await review.getByLabel('Review author',{exact:true}).fill('Reviewer');await review.getByLabel('Track changes',{exact:true}).check();await close();await position();
  if(enter)await page.keyboard.press('Enter');else if(deletion||!whole)await menu(deletion?'Delete items':'Insert item after');
  await expect(pending).toHaveCount(1);await expect(items).toHaveCount(deletion||whole?3:4);
  if(whole&&!deletion){
    await menu('Delete items');await expect(pending).toHaveCount(0);await expect(editor).toHaveText(original);await editor.press('Control+z');await expect(pending).toHaveCount(1);
  }else if(!deletion){
    await page.keyboard.type('Added item');await expect(pending).toHaveText('Added item');
    await menu('Delete items');await expect(pending).toHaveCount(0);await expect(editor).toHaveText(original);
    await editor.press('Control+z');await expect(pending).toHaveText('Added item');
  }
  await open();await expect(review.locator('.review-list button')).toHaveCount(1);await review.getByLabel('Review preview',{exact:true}).selectOption('original');await expect(review.getByLabel('original document preview',{exact:true})).toHaveText(original);
  await review.getByLabel('Review preview',{exact:true}).selectOption('final');const final=await review.getByLabel('final document preview',{exact:true}).textContent();if(deletion)expect(final).not.toContain('Middle item');else expect(final).toContain(whole?'Middle item':'Added item');await close();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const exported=await page.evaluate(async()=>{const projects=await window.alder.request('GET','/api/projects');const source=await window.alder.request('GET',`/api/projects/${projects.projects[0].id}`);const result=await window.alder.request('POST',`/api/projects/${source.id}/export`,{format:'docx'});const response=await fetch(window.alder.mediaBase+result.downloadUrl);return{source,result,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};});
  const file=path.join(directory,'alder.docx');fs.writeFileSync(file,Buffer.from(exported.bytes));fs.writeFileSync(path.join(directory,'fixture-project.json'),JSON.stringify(exported.source));fs.writeFileSync(path.join(directory,'fixture-exports.json'),JSON.stringify({docx:{...exported.result,path:file},reviewDecisions:true,skipListNumbers:true,expectedText:['First item','Last item']}));
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'Tracked list items'}).click();await expect(pending).toHaveCount(1);
  for(const scale of ['0.5','1.5','1']){
    await page.keyboard.press('Control+,');const settings=page.getByRole('dialog',{name:'Settings',exact:true});await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(scale);await settings.getByRole('button',{name:'Close settings',exact:true}).click();await open();expect(await review.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})).toBe(true);await close();
  }
  await page.screenshot({path:path.join(directory,'pending-item.png')});
  for(const decision of ['Reject','Accept']){
    await open();await review.getByRole('button',{name:decision,exact:true}).click();await close();await expect(pending).toHaveCount(0);await expect(editor).toHaveText(decision==='Reject'?original:final);
    if(deletion){await expect(editor.locator('[data-comment-thread]')).toHaveCount(decision==='Reject'?2:0);await menu('Comments…');await expect(comments).not.toContainText('Anchor incomplete');await comments.getByRole('button',{name:'Close',exact:true}).click();}
    await editor.press('Control+z');await expect(pending).toHaveCount(1);
  }
  expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);process.exitCode=1;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));if(report.status==='failed')await app?.evaluate(({app})=>app.exit(1)).catch(()=>{});await app?.close().catch(()=>{});}
