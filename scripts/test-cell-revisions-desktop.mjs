import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tableReview=process.argv.includes('--table');
const columns=process.argv.includes('--columns');
const merged=process.argv.includes('--merged'),horizontal=process.argv.includes('--horizontal'),cellCount=horizontal?6:merged?3:2;
const directory=path.resolve(`work/${tableReview?'table':'cell'}-revisions${columns?'-columns':''}${merged?'-merged':''}${horizontal?'-horizontal':''}-ui`);fs.mkdirSync(directory,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-cell-review-'));
const report={status:'running',errors:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.getByRole('button',{name:'New',exact:true}).click();await page.getByRole('button',{name:'Word Document',exact:false}).click();await page.getByLabel('Name',{exact:true}).fill('Cell review');await page.getByRole('button',{name:'Create',exact:true}).click();
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(1440,1000);w.show();w.focus();});
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true});
  const menu=async label=>{await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();};
  const review=page.getByRole('dialog',{name:'Review changes',exact:true}),open=()=>menu('Review changes…'),close=()=>review.getByRole('button',{name:'Done',exact:true}).click();
  await editor.click();await editor.evaluate((el,{merged,horizontal})=>{const data=new DataTransfer();data.setData('text/html',`<table><tr><td${merged?' rowspan="2"':''}${horizontal?' colspan="2"':''}><p>Left wording</p></td><td><p>Right wording</p></td></tr>${merged?'<tr><td><p>Lower right wording</p></td></tr>':''}${horizontal?'<tr><td><p>Bottom cell 1</p></td><td><p>Bottom cell 2</p></td><td><p>Bottom cell 3</p></td></tr>':''}</table>`);el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));},{merged,horizontal});
  const cells=editor.locator('td'),pending=editor.locator('td[data-revision-paragraph]');await expect(cells).toHaveCount(cellCount);const original=await editor.textContent();
  if(columns){
    await cells.first().click();await cells.last().click({modifiers:['Shift']});await menu('Table properties…');
    const initial=page.getByRole('dialog',{name:'Table properties',exact:true});await initial.getByLabel('Column width (mm)',{exact:true}).fill('35');await initial.getByRole('button',{name:'Apply',exact:true}).click();
  }
  const originalWidths=await cells.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-colwidth')));
  await open();await review.getByLabel('Review author',{exact:true}).fill('Reviewer');await review.getByLabel('Track changes',{exact:true}).check();await close();
  if(columns){
    const edge=await cells.first().boundingBox();await page.mouse.move(edge.x+edge.width-1,edge.y+edge.height/2);
    await expect(editor).toHaveClass(/resize-cursor/);await page.mouse.down();await page.mouse.move(edge.x+edge.width+59,edge.y+edge.height/2,{steps:8});await page.mouse.up();
    await expect.poll(()=>pending.count()).toBeGreaterThan(0);expect(await cells.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-colwidth')))).not.toEqual(originalWidths);
    await open();await expect(review.locator('.review-list button')).toHaveCount(1);await close();
    await editor.press('Control+z');await expect(pending).toHaveCount(0);expect(await cells.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-colwidth')))).toEqual(originalWidths);
  }
  await cells.first().click();await cells.last().click({modifiers:['Shift']});await expect(editor.locator('.selectedCell')).toHaveCount(cellCount);
  await menu('Table properties…');const dialog=page.getByRole('dialog',{name:'Table properties',exact:true});
  if(tableReview){await dialog.getByLabel('Table alignment',{exact:true}).selectOption('right');await dialog.getByLabel('Minimum row height (pt)',{exact:true}).fill('64');await dialog.getByLabel('Row breaks',{exact:true}).selectOption('true');}
  if(columns)await dialog.getByLabel('Column width (mm)',{exact:true}).fill('50');
  await dialog.getByLabel('Cell vertical alignment',{exact:true}).selectOption('bottom');
  await dialog.getByLabel('Top padding (pt)',{exact:true}).fill('12');await dialog.getByLabel('Bottom padding (pt)',{exact:true}).fill('9');await dialog.getByLabel('Left padding (pt)',{exact:true}).fill('15');
  await dialog.getByLabel('Border width (pt)',{exact:true}).fill('1.5');await dialog.getByLabel('Border colour',{exact:true}).fill('#203854');await dialog.getByLabel('Shading',{exact:true}).fill('#d6e2ef');await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(pending).toHaveCount(cellCount);await expect(cells.first()).toHaveCSS('padding-top','16px');await expect(cells.first()).toHaveCSS('background-color','rgb(214, 226, 239)');await expect(editor).toHaveText(original);
  if(tableReview){await expect(editor.locator('table')).toHaveAttribute('data-table-align','right');await expect(editor.locator('tr')).toHaveAttribute('data-allow-split','true');}
  const finalWidths=await cells.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-colwidth')));if(columns)expect(finalWidths).not.toEqual(originalWidths);
  await editor.press('Control+z');await expect(pending).toHaveCount(0);await editor.press('Control+y');await expect(pending).toHaveCount(cellCount);
  await open();await expect(review.locator('.review-list button')).toHaveCount(1);await expect(review.locator('.review-list')).toContainText('Cell:');
  await review.getByLabel('Review preview',{exact:true}).selectOption('original');await expect(review.getByLabel('original document preview',{exact:true}).locator('td').first()).not.toHaveCSS('background-color','rgb(214, 226, 239)');await close();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const exported=await page.evaluate(async()=>{const projects=await window.alder.request('GET','/api/projects');const source=await window.alder.request('GET',`/api/projects/${projects.projects[0].id}`);const result=await window.alder.request('POST',`/api/projects/${source.id}/export`,{format:'docx'});const response=await fetch(window.alder.mediaBase+result.downloadUrl);return{source,result,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};});
  const file=path.join(directory,'alder.docx');fs.writeFileSync(file,Buffer.from(exported.bytes));fs.writeFileSync(path.join(directory,'fixture-project.json'),JSON.stringify(exported.source));fs.writeFileSync(path.join(directory,'fixture-exports.json'),JSON.stringify({docx:{...exported.result,path:file},reviewDecisions:true,skipListNumbers:true,expectedText:['Left wording','Right wording']}));
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'Cell review'}).click();await expect(pending).toHaveCount(cellCount);
  for(const scale of ['0.5','1.5','1']){
    await page.keyboard.press('Control+,');const settings=page.getByRole('dialog',{name:'Settings',exact:true});await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(scale);await settings.getByRole('button',{name:'Close settings',exact:true}).click();await open();expect(await review.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})).toBe(true);await close();
  }
  await page.screenshot({path:path.join(directory,'pending-cell-formatting.png')});
  for(const decision of ['Reject','Accept']){
    await open();await review.getByRole('button',{name:decision,exact:true}).click();await close();await expect(pending).toHaveCount(0);await expect(editor).toHaveText(original);
    if(decision==='Reject')await expect(cells.first()).not.toHaveCSS('background-color','rgb(214, 226, 239)');else await expect(cells.first()).toHaveCSS('background-color','rgb(214, 226, 239)');
    if(tableReview){await expect(editor.locator('table')).toHaveAttribute('data-table-align',decision==='Reject'?'left':'right');await expect(editor.locator('tr')).toHaveAttribute('data-allow-split',decision==='Reject'?'false':'true');}
    if(merged){await expect(cells.first()).toHaveAttribute('rowspan','2');if(horizontal)await expect(cells.first()).toHaveAttribute('colspan','2');}
    if(columns)expect(await cells.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-colwidth')))).toEqual(decision==='Reject'?originalWidths:finalWidths);
    await editor.press('Control+z');await expect(pending).toHaveCount(cellCount);
  }
  expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);process.exitCode=1;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));if(report.status==='failed')await app?.evaluate(({app})=>app.exit(1)).catch(()=>{});await app?.close().catch(()=>{});}
