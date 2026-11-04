import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const continued=process.argv.includes('--continued');
const outline=process.argv.includes('--outline');
const paragraphs=process.argv.includes('--paragraphs');
const tables=process.argv.includes('--tables');
const nested=process.argv.includes('--nested');
const directory=path.resolve(`work/list-revisions${outline?'-outline':''}${continued?'-continued':''}${paragraphs?'-paragraphs':''}${tables?'-tables':''}${nested?'-nested':''}-ui`);fs.mkdirSync(directory,{recursive:true});
const pendingCount=outline&&continued?2:1;
const originalLabels=['3.','3.1.','3.2.','4.',...(continued?['5.','5.1.','6.']:[])],finalLabels=['Article VII.','VII-1.','VII-2.','Article VIII.',...(continued?['Article IX.','IX-1.','Article X.']:[])];
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-list-review-'));
const report={status:'running',errors:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.getByRole('button',{name:'New',exact:true}).click();await page.getByRole('button',{name:'Word Document',exact:false}).click();await page.getByLabel('Name',{exact:true}).fill('List review');await page.getByRole('button',{name:'Create',exact:true}).click();
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(1440,1000);w.show();w.focus();});
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true});
  const authored=()=>editor.evaluate(el=>{const copy=el.cloneNode(true);copy.querySelectorAll('.outline-list-number').forEach(n=>n.remove());return copy.textContent;});
  const menu=async label=>{await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();};
  const review=page.getByRole('dialog',{name:'Review changes',exact:true}),open=()=>menu('Review changes…'),close=()=>review.getByRole('button',{name:'Done',exact:true}).click();
  await editor.click();await editor.evaluate((el,{continued,outline,paragraphs,tables,nested})=>{
    const data=new DataTransfer();let html='<ol start="3"><li><p>First item</p><p>Continuation wording</p></li><li><p>Second item</p></li></ol><p>After list</p>'+(continued?'<ol data-continue-list="true"><li><p>Later first item</p></li><li><p>Later second item</p></li></ol>':'');
    if(outline){const list=document.createElement('ol');list.start=3;list.setAttribute('data-list-template',JSON.stringify(Array.from({length:9},(_,i)=>({format:'decimal',pattern:Array.from({length:i+1},(_,n)=>`%${n+1}`).join('.')+'.',start:1,restart:i,indent:24*(i+1),hanging:18}))));list.innerHTML='<li><p>First item</p><ol><li><p>Nested first</p></li><li><p>Nested second</p></li></ol></li><li><p>Second item</p></li>';html=list.outerHTML+'<p>After list</p>';if(continued){const later=list.cloneNode(false);later.setAttribute('data-continue-list','true');later.innerHTML='<li><p>Later first item</p><ol><li><p>Later nested item</p></li></ol></li><li><p>Later second item</p></li>';html+=later.outerHTML;}}
    if(outline&&paragraphs){const container=document.createElement('div');container.innerHTML=html;container.querySelectorAll('ol>li:first-child').forEach((item,i)=>{const p=document.createElement('p');p.style.marginLeft='5pt';p.style.textIndent='3pt';p.textContent=`Continued wording ${i}`;item.insertBefore(p,item.children[1]||null);});html=container.innerHTML;}
    if(tables){const container=document.createElement('div');container.innerHTML=html;container.querySelectorAll('ol>li:first-child').forEach((item,i)=>{const table=document.createElement('table');table.innerHTML=`<tr><td rowspan="2"><p>Left cell ${i}</p></td><td><p>Right cell ${i}</p></td></tr><tr><td><p>Lower cell ${i}</p></td></tr>`;item.insertBefore(table,item.children[1]||null);});html=container.innerHTML;}
    if(nested)html='<ul><li><p>Outer item</p>'+html+'<p>Outer continuation</p></li><li><p>Other outer item</p></li></ul>';
    data.setData('text/html',html);el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  },{continued,outline,paragraphs,tables,nested});
  const listing=editor.locator('ol').first(),pending=editor.locator('ol[data-revision-paragraph]'),following=editor.locator('ol[data-continue-list]');await expect(editor.locator('ol')).toHaveCount(outline?(continued?4:2):continued?2:1);const original=await authored();
  if(continued)await expect(following).toHaveAttribute('start','5');
  await open();await review.getByLabel('Review author',{exact:true}).fill('Reviewer');await review.getByLabel('Track changes',{exact:true}).check();await close();
  await listing.locator('p').first().click();await menu('List…');const dialog=page.getByRole('dialog',{name:'List',exact:true});
  if(outline){
    await dialog.getByLabel('Outline number format',{exact:true}).selectOption('upper-roman');await dialog.getByLabel('Outline number pattern',{exact:true}).fill('Article %1.');await dialog.getByLabel('Outline level start',{exact:true}).fill('7');await dialog.getByLabel('Outline indent',{exact:true}).fill('30');await dialog.getByLabel('Outline hanging indent',{exact:true}).fill('24');
    await dialog.getByLabel('Outline level',{exact:true}).selectOption({value:'1'});await expect(dialog.getByLabel('Outline level',{exact:true})).toHaveValue('1');await dialog.getByLabel('Outline number pattern',{exact:true}).fill('%1-%2.');await dialog.getByLabel('Outline indent',{exact:true}).fill('60');await dialog.getByLabel('Outline hanging indent',{exact:true}).fill('22');
  }else{await dialog.getByLabel('List markers',{exact:true}).selectOption('upper-roman');await dialog.getByLabel('List start',{exact:true}).fill('7');}
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(pending).toHaveCount(pendingCount);await expect(listing).toHaveAttribute('start','7');if(!outline)await expect(listing).toHaveCSS('list-style-type','upper-roman');else {expect(JSON.parse(await listing.getAttribute('data-list-template'))[1].indent).toBe(60);await expect(editor.locator('.outline-list-number')).toHaveText(finalLabels);}await expect.poll(authored).toBe(original);
  if(continued)await expect(following).toHaveAttribute('start',outline?'9':'1');
  await editor.press('Control+z');await expect(pending).toHaveCount(0);await expect(listing).toHaveAttribute('start','3');await editor.press('Control+y');await expect(pending).toHaveCount(pendingCount);
  await open();await expect(review.locator('.review-list button')).toHaveCount(1);await expect(review.locator('.review-list')).toContainText('List:');await review.getByLabel('Review preview',{exact:true}).selectOption('original');await expect(review.getByLabel('original document preview',{exact:true}).locator('ol').first()).toHaveAttribute('start','3');await close();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const exported=await page.evaluate(async()=>{const projects=await window.alder.request('GET','/api/projects');const source=await window.alder.request('GET',`/api/projects/${projects.projects[0].id}`);const result=await window.alder.request('POST',`/api/projects/${source.id}/export`,{format:'docx'});const response=await fetch(window.alder.mediaBase+result.downloadUrl);return{source,result,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};});
  const file=path.join(directory,'alder.docx');fs.writeFileSync(file,Buffer.from(exported.bytes));fs.writeFileSync(path.join(directory,'fixture-project.json'),JSON.stringify(exported.source));fs.writeFileSync(path.join(directory,'fixture-exports.json'),JSON.stringify({docx:{...exported.result,path:file},reviewDecisions:true,skipListNumbers:true,expectedText:['First item']}));
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'List review'}).click();await expect(pending).toHaveCount(pendingCount);
  for(const scale of ['0.5','1.5','1']){
    await page.keyboard.press('Control+,');const settings=page.getByRole('dialog',{name:'Settings',exact:true});await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(scale);await settings.getByRole('button',{name:'Close settings',exact:true}).click();await open();expect(await review.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})).toBe(true);await close();
  }
  await page.screenshot({path:path.join(directory,'pending-list-formatting.png')});
  for(const decision of ['Reject','Accept']){
    await open();await review.getByRole('button',{name:decision,exact:true}).click();await close();await expect(pending).toHaveCount(0);await expect.poll(authored).toBe(original);await expect(listing).toHaveAttribute('start',decision==='Reject'?'3':'7');
    if(outline)await expect(editor.locator('.outline-list-number')).toHaveText(decision==='Reject'?originalLabels:finalLabels);
    if(continued)await expect(following).toHaveAttribute('start',decision==='Reject'?'5':outline?'9':'1');
    await editor.press('Control+z');await expect(pending).toHaveCount(pendingCount);
  }
  expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);process.exitCode=1;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));if(report.status==='failed')await app?.evaluate(({app})=>app.exit(1)).catch(()=>{});await app?.close().catch(()=>{});}
