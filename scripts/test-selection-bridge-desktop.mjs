import { _electron as electron, expect } from '@playwright/test';
import { build } from 'esbuild';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const directory=path.resolve('work/selection-bridge'), profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-selection-bridge-'));
fs.mkdirSync(directory,{recursive:true});const report={status:'running',checks:[],errors:[]};let app;
try {
  await build({entryPoints:['scripts/selection-bridge-probe.tsx'],bundle:true,outfile:path.join(directory,'probe.js'),platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'}});
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  const page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));
  await expect(page.getByRole('button',{name:'New',exact:true})).toBeVisible();
  await page.evaluate(fs.readFileSync(path.join(directory,'probe.js'),'utf8'));
  await expect(page.getByRole('button',{name:'Other element',exact:true})).toBeVisible();
  for(const mode of ['backwards','node','cells','pending']) {
    const result=await page.evaluate(mode=>window.__selectionBridgeProbe(mode),mode);
    expect(result.focused).toBe(true);expect(result.endpoints).toBe(true);expect(result.text).toBe(result.expectedText);
    if(mode!=='pending')expect(result.model).toBe(result.expectedModel);
    report.checks.push({mode,...result});
  }
  expect(report.errors).toEqual([]);report.status='passed';
} catch(e) {report.status='failed';report.error=e.stack;throw e;}
finally {fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));await app?.close();}
