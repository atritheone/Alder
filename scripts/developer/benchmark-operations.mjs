// Developer operating qualification. Every scenario owns a disposable profile.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { desktopExecutable } from '../desktop-paths.mjs';
const {values}=parseArgs({options:{resources:{type:'string'},output:{type:'string'},settle:{type:'string',default:'5000'}}});
const resources=path.resolve(values.resources||process.env.ALDER_RESOURCES_DIR||'work/bundle-resources');
const output=values.output||fs.mkdtempSync(path.join(os.tmpdir(),'alder-operations-'));fs.mkdirSync(output,{recursive:true});
const layout=JSON.parse(fs.readFileSync(new URL('../../backend/alder/runtime-layout.json',import.meta.url)))[process.platform];
const generated=spawnSync(path.join(resources,layout.python),['-B',fileURLToPath(new URL('opening-fixtures.py',import.meta.url)),path.join(output,'fixtures')],{encoding:'utf8',windowsHide:true});
if(generated.status!==0)throw Error(generated.stderr);
const report={platform:process.platform,architecture:process.arch,status:'running',scenarios:[]};
const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
const mod=process.platform==='darwin'?'Meta':'Control';
for(const filename of ['Small UTF8.txt','Large 1MiB.txt','Large 1000 paragraphs.docx']){
 const profile=fs.mkdtempSync(path.join(output,'profile-'));let app;
 const sample={filename,status:'running',editsMs:[],errors:[]};
 try{
  const env={...process.env,ALDER_DATA_DIR:path.join(profile,'data'),ALDER_RESOURCES_DIR:resources};
  for(const key of ['PYTHONHOME','PYTHONPATH','ELECTRON_RUN_AS_NODE'])delete env[key];
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/chromium`],env,timeout:60000});
  const page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',e=>sample.errors.push(e.message));
  await page.evaluate(()=>window.alder.ready());
  await app.evaluate(()=>{const original=globalThis.fetch;globalThis.unsolicitedPrepare=0;globalThis.fetch=(...args)=>{if(String(args[0]).endsWith('/api/speech/prepare'))globalThis.unsolicitedPrepare++;return original(...args);};});
  await page.locator('.start-screen input[type=file]').setInputFiles(path.join(output,'fixtures',filename));
  const editor=page.locator('[contenteditable=true]').filter({hasText:'ALDER_OPEN_BEGIN'}).first();await expect(editor).toBeVisible();
  await page.waitForTimeout(Number(values.settle));
  const snapshot=()=>page.evaluate(async()=>{const p=await window.alder.request('GET',`/api/projects/${localStorage.getItem('alder.project')}`);return p.book.chapters.map(c=>c.text).join('\n');});
  const before=await snapshot();await editor.focus();await page.keyboard.press(process.platform==='darwin'?'Meta+ArrowUp':'Control+Home');
  for(let i=0;i<18;i++){const t=performance.now();await page.keyboard.type('x');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));sample.editsMs.push(performance.now()-t);}
  const stop=performance.now();await expect(page.locator('.save-status')).toHaveText('Saved',{timeout:30000});sample.quietSaveMs=performance.now()-stop;
  expect(await snapshot()).toBe('x'.repeat(18)+before);
  for(let i=0;i<6;i++){await page.keyboard.type('x');await page.waitForTimeout(650);}
  const pause=performance.now();await expect(page.locator('.save-status')).toHaveText('Saved',{timeout:30000});sample.pausedSaveMs=performance.now()-pause;
  expect(await snapshot()).toBe('x'.repeat(24)+before);
  await page.keyboard.press(mod+'+z');await page.keyboard.press(mod+'+Shift+Z');
  await expect(page.locator('.save-status')).toHaveText('Saved',{timeout:30000});
  expect(await snapshot()).toBe('x'.repeat(24)+before);
  sample.unsolicitedPrepare=await app.evaluate(()=>globalThis.unsolicitedPrepare);expect(sample.unsolicitedPrepare).toBe(0);
  sample.status=sample.errors.length?'failed':'passed';
 }catch(error){sample.status='failed';sample.error=String(error.stack||error);}
 finally{await app?.close();}
 report.scenarios.push(sample);save();console.log(JSON.stringify(sample));
}
report.status=report.scenarios.every(s=>s.status==='passed')?'passed':'failed';save();
if(report.status!=='passed')process.exitCode=1;
