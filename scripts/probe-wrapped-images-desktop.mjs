import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory=path.resolve('work/wrapped-images-ui'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-wrapped-'));
fs.mkdirSync(directory,{recursive:true});
const report={status:'running',errors:[]};let app,page;
try{
 app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
 page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
 await app.evaluate(({app})=>{app.on('web-contents-created',(_event,contents)=>{const print=contents.printToPDF.bind(contents);contents.printToPDF=async options=>{globalThis.__wrappedHTML=await contents.executeJavaScript('document.documentElement.outerHTML');return print(options);};});});
 await expect(page.getByRole('button',{name:'New',exact:true})).toBeVisible();
 const fixture=JSON.parse(fs.readFileSync('work/wrapped-images-word/fixture-project.json','utf8'));
 const id=await page.evaluate(async p=>{
  const value=await window.alder.request('POST','/api/projects',{name:'Wrapped images',template:'blank'});
  const bytes=Uint8Array.from(atob(p.assets[0].data),c=>c.charCodeAt(0));
  const asset=await window.alder.upload(`/api/projects/${value.id}/assets?register=false`,'sample.png',[...bytes],{});
  value.assets=[asset];const remap=n=>{if(['image','inline_image'].includes(n.type)){n.attrs.assetId=asset.id;n.attrs.src=`/api/projects/${value.id}/assets/${asset.id}`;}n.content?.forEach(remap);};
  p.book.chapters.forEach(c=>remap(c.document));value.book=p.book;value.settings=p.settings;
  await window.alder.request('PUT',`/api/projects/${value.id}`,{project:value,expectedRevision:value.revision});return value.id;
 },fixture);
 await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'Wrapped images'}).click();
 const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true});
 await expect(editor.locator('img[data-image-wrap]')).toHaveCount(2);await expect(page.locator('.save-status')).toHaveText('Saved');
 report.geometry=await editor.evaluate(root=>{
  const sheets=[...document.querySelectorAll('.page-sheets > .page-sheet')].map(p=>p.getBoundingClientRect());
  return [...root.querySelectorAll('p,img[data-image-wrap]')].map(p=>{const r=p.getBoundingClientRect();return {tag:p.tagName,text:p.textContent?.slice(0,12),wrap:p.getAttribute('data-image-wrap'),top:r.top,bottom:r.bottom,left:r.left,right:r.right,page:sheets.findIndex(s=>r.top>=s.top&&r.bottom<=s.bottom)};});
 });
 report.pages=await page.locator('.page-sheets > .page-sheet').count();
 await page.screenshot({path:path.join(directory,'editor.png')});
 fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
 const pdf=await page.evaluate(async id=>{const result=await window.alder.request('POST',`/api/projects/${id}/export`,{format:'pdf'});return {result,bytes:[...new Uint8Array(await(await fetch(window.alder.mediaBase+result.downloadUrl)).arrayBuffer())]};},id);
 fs.writeFileSync(path.join(directory,'pictures.pdf'),Buffer.from(pdf.bytes));report.pdf=pdf.result.validation;
 fs.writeFileSync(path.join(directory,'publication.html'),await app.evaluate(()=>globalThis.__wrappedHTML));
 expect(report.errors).toEqual([]);report.status='measured';
}catch(error){report.status='failed';report.error=error.stack;fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));await page?.screenshot({path:path.join(directory,'failure.png'),timeout:5000}).catch(()=>{});throw error;}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));await app?.close();}
