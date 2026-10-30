import {_electron as electron,expect} from '@playwright/test';
import {desktopExecutable} from './desktop-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory=path.resolve('work/columns-ui'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-columns-'));
fs.mkdirSync(directory,{recursive:true});
const report={status:'running',checks:[],errors:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(8000);page.on('pageerror',e=>report.errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1440,1000);w.show();w.focus();});
  await expect(page.getByRole('button',{name:'New',exact:true})).toBeVisible();
  const id=await page.evaluate(async()=>{
    const p=await window.alder.request('POST','/api/projects',{name:'Columns fixture',template:'blank'});
    Object.assign(p.settings,{documentKind:'docx',includeTitle:false,pageSize:'A5',marginMm:15,footer:true});
    p.book={version:1,chapters:[{id:'chapter',title:'Document',include:true,document:{type:'doc',content:[{type:'paragraph',attrs:{lineSpacingMode:'exact',lineSpacing:15,spaceBefore:0,spaceAfter:0},content:Array.from({length:50},(_,i)=>[{type:'text',text:'COLUMN'+String(i).padStart(3,'0')+' small sentence.'},{type:'hard_break'}]).flat().slice(0,-1)}]}}]};
    await window.alder.request('PUT',`/api/projects/${p.id}`,{project:p,expectedRevision:p.revision});return p.id;
  });
  const reopen=async()=>{await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'Columns fixture'}).click();};
  const settings=page.getByRole('dialog',{name:'Settings',exact:true});
  const openSettings=async()=>{await app.evaluate(({Menu,BrowserWindow})=>{const item=Menu.getApplicationMenu().items.flatMap(m=>m.submenu?.items||[]).find(i=>i.label==='Settings…');Reflect.apply(item.click,item,[{triggeredByAccelerator:false},BrowserWindow.getAllWindows()[0],{}]);});await settings.getByRole('tab',{name:'Page Layout',exact:true}).click();};
  await reopen();
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true}),sheets=page.locator('.page-sheets > .page-sheet');
  await expect(sheets).toHaveCount(2);
  await openSettings();await settings.getByLabel('Columns',{exact:true}).selectOption('2');await settings.getByLabel('Line between columns',{exact:true}).check();await settings.getByLabel('Column gap',{exact:true}).fill('6');await settings.getByRole('button',{name:'Done',exact:true}).click();
  await expect(sheets).toHaveCount(1);
  const point=async(word)=>editor.evaluate((el,word)=>{
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),canvas=el.closest('.flow-canvas'),origin=canvas.getBoundingClientRect(),scale=origin.width/parseFloat(canvas.style.width);
    while(walker.nextNode()){const node=walker.currentNode,at=node.textContent.indexOf(word);if(at<0)continue;const r=document.createRange();r.setStart(node,at+3);r.setEnd(node,at+3);const b=r.getBoundingClientRect();return {x:b.x,y:(b.top+b.bottom)/2,localX:(b.x-origin.x)/scale};}
  },word);
  for(const [scale,zoom] of [[1,1],[.5,.5],[1.5,3]]){
    await openSettings();await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(String(scale));await settings.getByRole('button',{name:'Done',exact:true}).click();await page.getByLabel('Page zoom',{exact:true}).selectOption(String(zoom));
    const left=await point('COLUMN000'),right=await point('COLUMN040');expect(right.localX-left.localX).toBeCloseTo(62*96/25.4,0);report.checks.push({scale,zoom,left,right});
  }
  await openSettings();await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption('1');await settings.getByRole('button',{name:'Done',exact:true}).click();await page.getByLabel('Page zoom',{exact:true}).selectOption('1');
  const target=await point('COLUMN040');await page.mouse.click(target.x,target.y);await page.keyboard.type('Q');await expect(editor).toContainText('COLQUMN040');await editor.press('Control+z');await expect(editor).not.toContainText('COLQUMN');
  await editor.press('Control+End');await page.getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name:'Insert column break',exact:true}).click();await expect(editor.locator('.column-break')).toHaveCount(1);await editor.press('Control+z');await expect(editor.locator('.column-break')).toHaveCount(0);
  await editor.press('Control+End');await page.getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name:'Insert section break…',exact:true}).click();
  const section=page.getByRole('dialog',{name:'Insert section break',exact:true});await section.getByLabel('Section start',{exact:true}).selectOption('continuous');await section.getByLabel('Columns',{exact:true}).selectOption('3');await section.getByRole('button',{name:'Insert',exact:true}).click();await expect(editor.locator('.section-break')).toHaveCount(1);await page.keyboard.type('AFTER SECTION');await expect(editor).toContainText('AFTER SECTION');
  await expect(page.locator('.save-status')).toHaveText('Saved');await reopen();await expect(editor).toContainText('AFTER SECTION');await openSettings();await expect(settings.getByLabel('Columns',{exact:true})).toHaveValue('2');await expect(settings.getByLabel('Column gap',{exact:true})).toHaveValue('6');await settings.getByRole('button',{name:'Done',exact:true}).click();
  const count=await sheets.count();await page.getByRole('tab',{name:'Pages',exact:true}).click();await expect(page.locator('.page-card')).toHaveCount(count);
  const outlines=await page.locator('.unit-sentence .unit-outline').evaluateAll(nodes=>nodes.map(n=>parseFloat(n.style.width)));expect(Math.max(...outlines)).toBeLessThan(240);
  await page.getByRole('tab',{name:'Write',exact:true}).click();
  const pdf=await page.evaluate(async id=>{const result=await window.alder.request('POST',`/api/projects/${id}/export`,{format:'pdf'});return {result,bytes:[...new Uint8Array(await(await fetch(window.alder.mediaBase+result.downloadUrl)).arrayBuffer())]};},id);expect(pdf.result.validation.pages).toBe(count);fs.writeFileSync(path.join(directory,'columns.pdf'),Buffer.from(pdf.bytes));
  expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.error=error.stack;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});throw error;}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));await app?.close();}
