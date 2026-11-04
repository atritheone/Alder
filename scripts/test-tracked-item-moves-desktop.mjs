import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const outline=process.argv.includes('--outline');
const directory=path.resolve(`work/tracked-item-moves-ui${outline?'-outline':''}`);fs.mkdirSync(directory,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-item-moves-'));
const report={status:'running',errors:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.getByRole('button',{name:'New',exact:true}).click();await page.getByRole('button',{name:'Word Document',exact:false}).click();await page.getByLabel('Name',{exact:true}).fill('Tracked item moves');await page.getByRole('button',{name:'Create',exact:true}).click();
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(1440,1000);w.show();w.focus();});
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true});
  const menu=async label=>{await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();};
  const review=page.getByRole('dialog',{name:'Review changes',exact:true}),open=()=>menu('Review changes…'),close=()=>review.getByRole('button',{name:'Done',exact:true}).click();
  await editor.click();await editor.evaluate((el,outline)=>{
    const list=document.createElement('ol');list.start=3;list.style.listStyleType='upper-alpha';
    if(outline)list.dataset.listTemplate=JSON.stringify(Array.from({length:9},(_,level)=>({format:'decimal',pattern:Array.from({length:level+1},(_,n)=>`%${n+1}`).join('.')+'.',start:1,restart:level,indent:24*(level+1),hanging:18})));
    list.innerHTML='<li><p>First item</p></li><li><p>Moved item</p><p>Continuation</p><ol><li><p>Nested first</p></li><li><p>Nested last</p></li></ol><p>After nested</p></li><li><p>Last item</p></li>';
    const data=new DataTransfer();data.setData('text/html',list.outerHTML);el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  },outline);
  const list=editor.locator('ol').first(),items=list.locator(':scope > li'),pending=list.locator(':scope > li[data-revision-block-move]');
  await expect(items).toHaveCount(3);const original=await editor.textContent();
  await editor.evaluate(el=>{el.focus();const item=el.querySelector('ol').children[1],first=item.querySelector('p'),last=item.lastElementChild,range=document.createRange();range.setStart(first,0);range.setEnd(last,last.childNodes.length);const s=getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await menu('Comments…');const comments=page.getByRole('dialog',{name:'Comments',exact:true});await comments.getByLabel('Comment author',{exact:true}).fill('Reader');await comments.getByLabel('Comment text',{exact:true}).fill('Keep this complete item.');await comments.getByRole('button',{name:'Add comment',exact:true}).click();
  await open();await review.getByLabel('Review author',{exact:true}).fill('Reviewer');await review.getByLabel('Track changes',{exact:true}).check();await close();
  await editor.evaluate(el=>{el.focus();const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let text;while(text=walker.nextNode())if(text.textContent==='Moved item')break;const range=document.createRange();range.setStart(text,6);range.setEnd(text,10);const s=getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await page.keyboard.press('Alt+Shift+ArrowDown');await expect(pending).toHaveCount(2);expect(await page.evaluate(()=>getSelection().toString())).toBe('item');
  await editor.press('Control+z');await expect(items).toHaveCount(3);await expect(editor).toHaveText(original);
  await menu('Move items down');await expect(pending).toHaveCount(2);expect(await page.evaluate(()=>getSelection().toString())).toBe('item');
  await expect(editor.locator('[data-comment-thread]')).toHaveCount(4);
  await menu('Comments…');await expect(comments.getByRole('listitem')).toHaveCount(1);await expect(comments).not.toContainText('Anchor incomplete');await comments.getByRole('button',{name:'Close',exact:true}).click();
  await open();await expect(review.locator('.review-list button')).toHaveCount(1);await review.getByLabel('Review preview',{exact:true}).selectOption('original');await expect(review.getByLabel('original document preview',{exact:true})).toHaveText(original);
  await review.getByLabel('Review preview',{exact:true}).selectOption('final');const final=await review.getByLabel('final document preview',{exact:true}).textContent();expect(final.indexOf('Last item')<final.indexOf('Moved item')).toBe(true);await close();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const exported=await page.evaluate(async()=>{const projects=await window.alder.request('GET','/api/projects');const source=await window.alder.request('GET',`/api/projects/${projects.projects[0].id}`);const result=await window.alder.request('POST',`/api/projects/${source.id}/export`,{format:'docx'});const response=await fetch(window.alder.mediaBase+result.downloadUrl);return{source,result,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};});
  const file=path.join(directory,'alder.docx');fs.writeFileSync(file,Buffer.from(exported.bytes));fs.writeFileSync(path.join(directory,'fixture-project.json'),JSON.stringify(exported.source));fs.writeFileSync(path.join(directory,'fixture-exports.json'),JSON.stringify({docx:{...exported.result,path:file},reviewDecisions:true,skipListNumbers:true,expectedText:['First item','Last item']}));
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'Tracked item moves'}).click();await expect(pending).toHaveCount(2);
  for(const scale of ['0.5','1.5','1']){
    await page.keyboard.press('Control+,');const settings=page.getByRole('dialog',{name:'Settings',exact:true});await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(scale);await settings.getByRole('button',{name:'Close settings',exact:true}).click();await open();expect(await review.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})).toBe(true);await close();
  }
  await page.screenshot({path:path.join(directory,'pending-item-move.png')});
  for(const decision of ['Reject','Accept']){
    await open();await review.getByRole('button',{name:decision,exact:true}).click();await close();await expect(pending).toHaveCount(0);await expect(items).toHaveCount(3);await expect(editor).toHaveText(decision==='Reject'?original:final);await expect(editor.locator('[data-comment-thread]')).toHaveCount(2);await editor.press('Control+z');await expect(pending).toHaveCount(2);
  }
  expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);process.exitCode=1;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));if(report.status==='failed')await app?.evaluate(({app})=>app.exit(1)).catch(()=>{});await app?.close().catch(()=>{});}
