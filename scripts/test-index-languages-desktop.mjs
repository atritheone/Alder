import {_electron as electron, expect as baseExpect} from '@playwright/test';
import {desktopExecutable} from './desktop-paths.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const expect=baseExpect.configure({timeout:20000}), directory=path.resolve('work/index-languages-ui'), profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-index-languages-'));
fs.mkdirSync(directory,{recursive:true}); const report={status:'running',errors:[]}; let app,page;
try {
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));
  await expect(page.getByRole('button',{name:'New',exact:true})).toBeVisible();
  const fixture=JSON.parse(fs.readFileSync('work/index-languages-word/fixture-project.json','utf8'));
  const id=await page.evaluate(async f=>{
    const p=await window.alder.request('POST','/api/projects',{name:f.name,template:'blank'});p.book=f.book;p.settings=f.settings;p.language=f.language;
    await window.alder.request('PUT',`/api/projects/${p.id}`,{project:p,expectedRevision:p.revision});return p.id;
  },fixture);
  const reopen=async()=>{await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:fixture.name}).click();};
  await reopen();
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true}), indexes=editor.locator('[data-contents-kind="index"]');
  const menu=async name=>{await page.getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();};
  await editor.press('Control+Home'); await menu('Update fields');
  const swedish=['Aachen, 1','Places','Zebra, 1','Åland, 1','Örebro, 1','Zebra, 1','Åland, 1','Älmhult, 1','Örebro, 1'];
  const english=['Aachen, 1','Åland, 1','Älmhult, 1','Örebro, 1','Places','Åland, 1','Örebro, 1','Zebra, 1','Zebra, 1'];
  await expect(indexes.nth(0).locator('p')).toHaveText(['sv-SE',...swedish]);
  await expect(indexes.nth(1).locator('p')).toHaveText(['en-US',...english]);
  await indexes.nth(1).click();
  await menu('Table of contents…');
  const dialog=page.getByRole('dialog',{name:'Table of contents',exact:true});
  await expect(dialog.getByLabel('Index sorting language',{exact:true})).toHaveValue('en-US');
  await dialog.getByLabel('Index sorting language',{exact:true}).fill('sv-SE');
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(indexes.nth(1).locator('p')).toHaveText(['en-US',...swedish]);
  await editor.press('Control+z');await expect(indexes.nth(1).locator('p')).toHaveText(['en-US',...english]);
  await editor.press('Control+y');await expect(indexes.nth(1).locator('p')).toHaveText(['en-US',...swedish]);
  await expect(page.locator('.save-status')).toHaveText('Saved');await reopen();
  await expect(indexes.nth(1)).toHaveAttribute('data-index-language','sv-SE');
  await expect(indexes.nth(1).locator('p')).toHaveText(['en-US',...swedish]);
  for(const scale of [.5,1,1.5]) {
    await page.keyboard.press('Control+,');const settings=page.getByRole('dialog',{name:'Settings',exact:true});
    await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(String(scale));await settings.getByRole('button',{name:'Done',exact:true}).click();
    await indexes.nth(1).click();await menu('Table of contents…');
    await expect(dialog.getByLabel('Index sorting language',{exact:true})).toBeInViewport();
    await dialog.getByRole('button',{name:'Close contents',exact:true}).click();
    await editor.press('ArrowLeft');
    await expect(indexes.nth(1)).not.toHaveClass(/ProseMirror-selectednode/);
    await editor.locator(':scope > p').first().click();
    await expect(editor.locator('.ProseMirror-selectednode')).toHaveCount(0);
    await editor.press('End');await editor.pressSequentially(' EDIT');
    await expect(editor.locator(':scope > p').first()).toHaveText('The source remains unchanged. EDIT');
    await editor.press('Control+z');
    await expect(editor.locator(':scope > p').first()).toHaveText('The source remains unchanged.');
  }
  const pdf=await page.evaluate(async id=>{const result=await window.alder.request('POST',`/api/projects/${id}/export`,{format:'pdf'});return {result,bytes:[...new Uint8Array(await(await fetch(window.alder.mediaBase+result.downloadUrl)).arrayBuffer())]};},id);
  fs.writeFileSync(path.join(directory,'indexes.pdf'),Buffer.from(pdf.bytes));report.export=pdf.result;
  await page.screenshot({path:path.join(directory,'indexes.png')});
  expect(report.errors).toEqual([]);report.status='passed';
} catch(error) {report.status='failed';report.error=error.stack;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});throw error;}
finally {fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));await app?.close();}
