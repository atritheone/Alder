import {_electron as electron,expect} from '@playwright/test';
import {desktopExecutable} from './desktop-paths.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const directory=path.resolve('work/citations-layout'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-citations-layout-'));
fs.mkdirSync(directory,{recursive:true});const report={status:'running',errors:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));
  await expect(page.getByRole('button',{name:'New',exact:true})).toBeVisible();
  const id=await page.evaluate(async()=>{
    const p=await window.alder.request('POST','/api/projects',{name:'Long citation layout',template:'blank'});p.settings={...p.settings,documentKind:'docx',includeTitle:false,pageSize:'A5',citationStyle:'ieee'};
    const content=Array.from({length:100},(_,i)=>({type:'paragraph',content:[
      {type:'text',text:`BODY${String(i).padStart(3,'0')} is supported by `},
      {type:'citation',attrs:{blockId:'cite'+i,items:[{source:{id:'source'+i,type:'book',title:`BIBSOURCE${String(i).padStart(3,'0')} A detailed study of measured document layout and portable source information`,author:[{family:'Researcher'+i,given:'Alex'}],issued:{'date-parts':[[2020]]},publisher:'Example Press'}}],renderedStyle:'ieee'},content:[{type:'text',text:'[stale]'}]},
      {type:'text',text:'.'}
    ]}));
    content.push({type:'bibliography',attrs:{title:'Sources',entryIds:[],renderedStyle:'ieee'},content:[{type:'paragraph',content:[{type:'text',text:'Pending bibliography'}]}]});
    p.book={version:1,chapters:[{id:'main',title:'Document',include:true,document:{type:'doc',content}}]};
    await window.alder.request('PUT',`/api/projects/${p.id}`,{project:p,expectedRevision:p.revision});return p.id;
  });
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'Long citation layout'}).click();
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true});await expect(editor.locator('[data-document-citation]')).toHaveCount(100);
  const start=Date.now();await page.getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name:'Update fields',exact:true}).click();await expect(editor.locator('[data-document-citation]').last()).toHaveText('[100]');await expect(editor.locator('[data-document-bibliography]>p')).toHaveCount(101);report.updateMilliseconds=Date.now()-start;
  const bibliography=editor.locator('[data-document-bibliography]');const content=await bibliography.textContent();expect(content).not.toContain('\n');for(let i=0;i<100;i++)expect(content.match(new RegExp(`BIBSOURCE${String(i).padStart(3,'0')}`,'g'))).toHaveLength(1);
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const first=await page.evaluate(async id=>window.alder.request('GET',`/api/projects/${id}`),id);fs.writeFileSync(path.join(directory,'project.json'),JSON.stringify(first));
  // Reverse source appearance while retaining citation identities and cached
  // values; explicit Update fields must refresh both sequence and bibliography.
  await page.evaluate(async({id,p})=>{p.book.chapters[0].document.content=[...p.book.chapters[0].document.content.slice(0,100).reverse(),p.book.chapters[0].document.content[100]];await window.alder.request('PUT',`/api/projects/${id}`,{project:p,expectedRevision:p.revision});}, {id,p:first});
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'Long citation layout'}).click();await page.getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name:'Update fields',exact:true}).click();await expect(editor.locator('[data-document-citation]').first()).toHaveText('[1]');await expect(bibliography.locator('p').nth(1)).toContainText('BIBSOURCE099');await expect(page.locator('.save-status')).toHaveText('Saved');
  const pdf=await page.evaluate(async id=>{const result=await window.alder.request('POST',`/api/projects/${id}/export`,{format:'pdf'});return {result,bytes:[...new Uint8Array(await(await fetch(window.alder.mediaBase+result.downloadUrl)).arrayBuffer())]};},id);fs.writeFileSync(path.join(directory,'citations.pdf'),Buffer.from(pdf.bytes));report.pages=pdf.result.validation.pages;expect(report.pages).toBeGreaterThan(3);expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.error=error.stack;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});throw error;}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));await app?.close();}
