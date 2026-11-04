import {_electron as electron,expect as baseExpect} from '@playwright/test';
import {desktopExecutable} from './desktop-paths.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const expect=baseExpect.configure({timeout:20000}),directory=path.resolve('work/index-groups-ui'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-index-groups-'));
fs.mkdirSync(directory,{recursive:true});const report={status:'running',errors:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(25000);page.on('pageerror',e=>report.errors.push(e.message));
  await expect(page.getByRole('button',{name:'New',exact:true})).toBeVisible();
  const fixture=JSON.parse(fs.readFileSync('work/index-groups-word/fixture-project.json','utf8'));
  const id=await page.evaluate(async fixture=>{
    const p=await window.alder.request('POST','/api/projects',{name:fixture.name,template:'blank'});p.book=fixture.book;p.settings=fixture.settings;
    await window.alder.request('PUT',`/api/projects/${p.id}`,{project:p,expectedRevision:p.revision});return p.id;
  },fixture);
  const reopen=async()=>{await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:fixture.name}).click();};
  await reopen();
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true}),indexes=editor.locator('[data-contents-kind="index"]');
  const menu=async name=>{await page.getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();};
  await editor.press('Control+Home');await menu('Update fields');
  await expect(indexes).toHaveCount(4);
  await expect(indexes.nth(1).locator('p')).toHaveText(['People index','Zebra, 1','Alpha, 1']);
  await expect(indexes.nth(2).locator('p')).toHaveText(['Subject index','Trees','Zebra, 1','Alder, 1']);
  await expect(indexes.nth(3).locator('p')).toHaveText(['Plain people','Alpha, 1','Zebra, 1']);
  await indexes.nth(3).click();await menu('Table of contents…');
  const contents=page.getByRole('dialog',{name:'Table of contents',exact:true});
  await expect(contents.getByLabel('Index group',{exact:true})).toHaveValue('P');
  await contents.getByLabel('Use sort text',{exact:true}).check();
  await contents.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(contents).not.toBeVisible();
  report.applied=await indexes.nth(3).evaluate(node=>({sort:node.dataset.indexSort,group:node.dataset.indexGroup,text:node.textContent}));
  await expect(indexes.nth(3).locator('p')).toHaveText(['Plain people','Zebra, 1','Alpha, 1']);
  await editor.press('Control+z');await expect(indexes.nth(3).locator('p')).toHaveText(['Plain people','Alpha, 1','Zebra, 1']);
  await editor.press('Control+Home');await menu('Index entries…');
  const entries=page.getByRole('dialog',{name:'Index entries',exact:true});
  await entries.getByLabel('Index entry',{exact:true}).selectOption('entry1');
  await expect(entries.getByLabel('Index group',{exact:true})).toHaveValue('P');
  await entries.locator('summary').filter({hasText:/^Sorting$/}).click();
  await expect(entries.getByLabel('Sort main entry as',{exact:true})).toHaveValue('Zeta');
  await entries.getByLabel('Index group',{exact:true}).selectOption('S');
  await entries.getByLabel('Sort main entry as',{exact:true}).fill('Before');
  await page.screenshot({path:path.join(directory,'index-entry.png')});
  await entries.getByRole('button',{name:'Apply',exact:true}).click();
  const alpha=editor.locator('[data-index-id="entry1"]'),read=()=>alpha.evaluate(node=>JSON.parse(node.dataset.indexEntry));
  await expect.poll(async()=>(await read()).indexGroup).toBe('S');
  await editor.press('Control+z');await expect.poll(async()=>(await read()).indexGroup).toBe('P');
  await editor.press('Control+y');await menu('Update fields');
  await expect(indexes.nth(1).locator('p')).toHaveText(['People index','Zebra, 1']);
  await expect(indexes.nth(2).locator('p')).toHaveText(['Subject index','Alpha, 1','Trees','Zebra, 1','Alder, 1']);
  await expect(page.locator('.save-status')).toHaveText('Saved');await reopen();
  await expect(indexes.nth(2).locator('p')).toHaveText(['Subject index','Alpha, 1','Trees','Zebra, 1','Alder, 1']);
  for(const scale of [.5,1,1.5]){
    await page.keyboard.press('Control+,');const settings=page.getByRole('dialog',{name:'Settings',exact:true});
    await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(String(scale));await settings.getByRole('button',{name:'Done',exact:true}).click();
    await expect(indexes.nth(1)).toContainText('Zebra, 1');
  }
  const pdf=await page.evaluate(async id=>{const result=await window.alder.request('POST',`/api/projects/${id}/export`,{format:'pdf'});return {result,bytes:[...new Uint8Array(await(await fetch(window.alder.mediaBase+result.downloadUrl)).arrayBuffer())]};},id);
  fs.writeFileSync(path.join(directory,'indexes.pdf'),Buffer.from(pdf.bytes));report.export=pdf.result;
  await page.getByRole('tab',{name:'Pages',exact:true}).click();await expect(page.locator('.page-card')).toHaveCount(5);
  await page.screenshot({path:path.join(directory,'indexes.png')});
  expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status="failed";report.error=error.stack;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});throw error;}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));await app?.close();}
