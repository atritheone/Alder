// Real exporters; hold ready delivery to exercise cancellation deterministically.
import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const directory=path.resolve('work/document-export-ui'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-export-ui-'));
fs.mkdirSync(directory,{recursive:true});
const report={status:'running',errors:[],checks:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>{
    const w=BrowserWindow.getAllWindows()[0];w.setSize(1440,1000);w.show();w.focus();
    const original=globalThis.fetch;globalThis.holdExport=true;globalThis.exportJobs=[];globalThis.measuredWord=false;globalThis.measuredPdf=false;
    globalThis.fetch=async(...args)=>{
      const response=await original(...args),url=String(args[0]),method=args[1]?.method||'GET';
      if(/\/api\/projects\/[^/]+\/export-jobs$/.test(url)&&response.ok){const job=await response.clone().json();globalThis.exportJobs.push(job.id);const body=JSON.parse(args[1].body);if(body.format==='docx')globalThis.measuredWord=Object.hasOwn(body.options||{},'measuredTextBoxes');return response;}
      if(/\/rendered-pdf$/.test(url)&&response.ok)globalThis.measuredPdf=true;
      if(globalThis.holdExport&&/\/api\/document-export-jobs\/[^/]+$/.test(url)&&method==='GET'&&response.ok){
        const job=await response.clone().json();
        if(job.status==='ready')return new Response(JSON.stringify({...job,status:'building'}),{status:200,headers:{'Content-Type':'application/json'}});
      }
      return response;
    };
  });
  await page.getByRole('button',{name:'New',exact:true}).click();
  await page.getByRole('button',{name:'Word Document',exact:false}).click();
  await page.getByLabel('Name',{exact:true}).fill('Export cancellation');await page.getByRole('button',{name:'Create',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true});await editor.fill('Authored words remain available.');
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const expectedText=await page.evaluate(async()=>{
    const list=await window.alder.request('GET','/api/projects');const p=await window.alder.request('GET',`/api/projects/${list.projects[0].id}`);
    p.book.chapters[0].document.content[0].content.push({type:'equation',attrs:{blockId:'export_equation',mathML:'<math xmlns="http://www.w3.org/1998/Math/MathML"><msup><mi>x</mi><mn>2</mn></msup></math>',latex:'x^2'},content:[{type:'text',text:'x to the power 2'}]});
    return (await window.alder.request('PUT',`/api/projects/${p.id}`,{project:p,expectedRevision:p.revision})).book.chapters[0].text;
  });
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'Export cancellation'}).click();await expect(editor).toBeVisible();
  const open=()=>app.evaluate(({Menu,BrowserWindow})=>{
    const item=Menu.getApplicationMenu().items.flatMap(menu=>menu.submenu?.items||[]).find(item=>item.label.startsWith('Export'));
    const window=BrowserWindow.getAllWindows()[0];Reflect.apply(item.click,item,[{triggeredByAccelerator:false},window,window.webContents]);
  });
  await open();const progress=page.locator('.build-progress');
  await page.getByRole('button',{name:'Word .docx document',exact:true}).click();
  await expect(progress).toContainText('Building export');await progress.getByRole('button',{name:'Cancel',exact:true}).click();await expect(progress).not.toBeVisible();
  await expect(page.locator('.export-result')).not.toBeVisible();report.checks.push('Cancel suppresses a prepared Word export.');
  expect(await app.evaluate(()=>globalThis.measuredWord)).toBe(true);
  for(const scale of ['0.5','1.5','1']){
    await page.keyboard.press('Control+,');const settings=page.getByRole('dialog',{name:'Settings',exact:true});
    await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(scale);await settings.getByRole('button',{name:'Close settings',exact:true}).click();
    await open();await page.getByRole('button',{name:'HTML Styled document',exact:true}).click();await expect(progress).toContainText('Building export');
    expect(await progress.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})).toBe(true);
    await page.keyboard.press('Escape');await expect(progress).not.toBeVisible();await expect(page.locator('.export-result')).not.toBeVisible();
  }
  report.checks.push('Escape works at 50/100/150% UI scale.');
  const cancelled=await app.evaluate(()=>globalThis.exportJobs.slice());
  const states=await page.evaluate(async ids=>Promise.all(ids.map(id=>window.alder.request('GET',`/api/document-export-jobs/${id}`))),cancelled);
  expect(states.every(job=>job.status==='cancelled')).toBe(true);
  for(const id of cancelled)expect(fs.existsSync(path.join(profile,'data','exports',id))).toBe(false);
  await app.evaluate(()=>{globalThis.holdExport=false;});
  await page.getByRole('button',{name:'Plain text Exact wording',exact:true}).click();await expect(page.locator('.export-result')).toBeVisible();
  const completeId=await app.evaluate(()=>globalThis.exportJobs.at(-1));
  const manifest=JSON.parse(fs.readFileSync(path.join(profile,'data','exports',completeId,'result.json'),'utf8'));
  expect(fs.readFileSync(manifest.path,'utf8').trim()).toBe(expectedText.trim());
  const source=await page.evaluate(async()=>{const list=await window.alder.request('GET','/api/projects');return window.alder.request('GET',`/api/projects/${list.projects[0].id}`);});
  expect(source.book.chapters[0].text).toBe(expectedText);
  report.checks.push('Cancellation removes generated files and successful export retains the exact source.');
  await page.getByRole('button',{name:'PDF Fixed pages',exact:true}).click();
  await expect(page.locator('.export-result strong')).toHaveText(/\.pdf$/);
  expect(await app.evaluate(()=>globalThis.measuredPdf)).toBe(true);
  report.checks.push('Word equations use measured geometry and PDF uses the verified desktop renderer.');
  await page.screenshot({path:path.join(directory,'export.png')});expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);process.exitCode=1;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));if(report.status==='failed')await app?.evaluate(({app})=>app.exit(1)).catch(()=>{});await app?.close().catch(()=>{});}
