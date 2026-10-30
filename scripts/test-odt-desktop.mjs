import { _electron as electron, expect as baseExpect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const expect=baseExpect.configure({timeout:30000});
const format=process.env.ALDER_EXCHANGE_FORMAT==='rtf'?'rtf':'odt';
const projectName=format==='odt'?'OpenDocument fixture':'RTF exchange';
const targetText=format==='odt'?'RIGHT_ONE':'EDIT_TARGET';
const directory=path.resolve(`work/${format}-ui`);
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-odt-'));
fs.mkdirSync(directory,{recursive:true});
const fixture=JSON.parse(fs.readFileSync(`work/${format}-word/fixture-exports.json`,'utf8'));
const report={status:'running',errors:[],checks:[]};
let app,page;
try {
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('dialog',async dialog=>{if(dialog.type()==='beforeunload')await dialog.accept().catch(()=>{});else{report.errors.push(dialog.message());await dialog.dismiss().catch(()=>{});}});
  await expect(page.getByRole('button',{name:'New',exact:true})).toBeVisible();
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setSize(1440,1000);window.show();window.focus();});
  // Open through the actual shared file input, exercising import and binding.
  await page.locator('.start-screen input[type="file"]').setInputFiles(fixture.docx.path);
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true});
  await expect(editor).toContainText(format.toUpperCase()+'_HEADING');
  const id=await page.evaluate(async name=>{const {projects}=await window.alder.request('GET','/api/projects');return projects.find(p=>p.name.startsWith(name)).id;},projectName);
  const project=await page.evaluate(id=>window.alder.request('GET',`/api/projects/${id}`),id);
  expect(project.settings.preferredFormat).toBe(format);
  if(format==='odt') {
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('td[rowspan="2"]')).toHaveCount(1);
    await expect(editor.locator('ol > li ul')).toHaveCount(1);
  } else {
    await expect(editor.locator('a[href="https://example.com/"]')).toHaveText('LINK');
    await expect(editor).toContainText('\u{1f600}');
  }
  await expect(page.locator('.page-sheets')).toContainText('NOTE_TEXT');
  const cell=editor.locator(format==='odt'?'td':'p').filter({hasText:targetText}).first();
  await cell.click();await page.keyboard.press('Home');await page.keyboard.type('EDITED ');
  await expect(cell).toContainText('EDITED '+targetText);
  await page.keyboard.press('Control+z');await expect(cell).not.toContainText('EDITED');
  await page.keyboard.type('EDITED ');await expect(cell).toContainText('EDITED');
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const destination=path.join(directory,'saved-through-file-menu.'+format);
  await app.evaluate(({dialog},destination)=>{
    globalThis.odtSaves=[];
    dialog.showSaveDialog=async(_window,options)=>{globalThis.odtSaves.push(options);return {canceled:false,filePath:destination};};
    dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});
  },destination);
  const source=fs.readFileSync(fixture.docx.path);
  await page.keyboard.press('Control+s');
  await expect.poll(()=>fs.existsSync(destination)).toBe(true);
  expect(fs.readFileSync(fixture.docx.path).equals(source)).toBe(true);
  const dialogs=await app.evaluate(()=>globalThis.odtSaves);
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0].defaultPath).toContain('Alder copy.'+format);
  expect(dialogs[0].filters[0].extensions).toEqual([format]);
  await page.reload();
  await page.getByRole('button',{name:'Open',exact:true}).click();
  await page.locator('.project-list-item').filter({hasText:projectName}).click();
  await expect(editor).toContainText('EDITED '+targetText);
  await page.keyboard.press('Control+s');
  await expect.poll(()=>app.evaluate(()=>globalThis.odtSaves.length)).toBe(1);
  for(const scale of [0.5,1.5,1]) {
    await page.keyboard.press('Control+,');
    const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
    await dialog.getByRole('tab',{name:'Appearance',exact:true}).click();
    await dialog.getByLabel('UI Scale',{exact:true}).selectOption(String(scale));
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await expect(editor).toContainText('EDITED '+targetText);
  }
  await page.getByRole('tab',{name:'Pages',exact:true}).click();
  await expect(page.locator('.page-card').first()).toBeVisible();
  await page.getByRole('tab',{name:'Write',exact:true}).click();
  await editor.press('Control+Home');
  await page.screenshot({path:path.join(directory,format+'.png')});
  const pdf=await page.evaluate(async id=>{const result=await window.alder.request('POST',`/api/projects/${id}/export`,{format:'pdf'});return [...new Uint8Array(await(await fetch(window.alder.mediaBase+result.downloadUrl)).arrayBuffer())];},id);
  fs.writeFileSync(path.join(directory,format+'.pdf'),Buffer.from(pdf));
  report.checks.push(format.toUpperCase()+' open, rich content, editing/undo, source-preserving first Save, persisted file binding, reload, UI scale, Arrangement and PDF');
  expect(report.errors).toEqual([]);report.status='passed';
} catch(error) {
  report.status='failed';report.error=error.stack;
  await page?.screenshot({path:path.join(directory,'failure.png'),timeout:5000}).catch(()=>{});
  throw error;
} finally {
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  await app?.close();
}
