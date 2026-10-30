import {_electron as electron,expect as baseExpect} from '@playwright/test';
import {desktopExecutable} from './desktop-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const expect=baseExpect.configure({timeout:45000}),directory=path.resolve('work/note-widths-ui'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-note-widths-'));
fs.mkdirSync(directory,{recursive:true});
const text=Array.from({length:400},(_,i)=>`NOTE${String(i).padStart(4,'0')} A footnote can follow changing page widths. `).join('');
const report={status:'running',errors:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.getByRole('button',{name:'New',exact:true}).waitFor();
  const id=await page.evaluate(async text=>{
    const p=await window.alder.request('POST','/api/projects',{name:'Changing note widths',template:'blank'});
    p.settings={...p.settings,documentKind:'docx',includeTitle:false,pageSize:'A4',marginMm:20};
    const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]});
    p.book={version:1,chapters:[{id:'main',title:'Text',include:true,document:{type:'doc',content:[
      {type:'paragraph',content:[{type:'text',text:'FIRST_BODY '},{type:'document_note',attrs:{blockId:'long-note',kind:'footnote',body:{type:'doc',content:[paragraph(text)]}}}]},
      {type:'section_break',attrs:{kind:'nextPage',page:{pageSize:'A5',marginMm:20}}},paragraph('SECOND_BODY'),
      {type:'section_break',attrs:{kind:'nextPage',page:{pageSize:'A4',marginMm:20}}},paragraph('THIRD_BODY'),
    ]}}]};
    await window.alder.request('PUT',`/api/projects/${p.id}`,{project:p,expectedRevision:p.revision});return p.id;
  },text);
  const reopen=async()=>{await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'Changing note widths'}).click();};
  await reopen();const sheets=page.locator('.page-sheets > .page-sheet');
  await expect(sheets.locator('[data-note-fragment]')).not.toHaveCount(0);
  await expect.poll(()=>sheets.count()).toBeGreaterThan(3);
  report.pages=await sheets.count();
  const geometry=()=>sheets.evaluateAll((pages,text)=>{
    const errors=[],widths=new Set();let words=0;
    for(const page of pages){
      const bounds=page.getBoundingClientRect();widths.add(Math.round(bounds.width));
      for(const word of page.querySelectorAll('[data-note-from]')){
        const r=word.getBoundingClientRect(),from=Number(word.dataset.noteFrom),to=Number(word.dataset.noteTo);words++;
        if(r.left<bounds.left-1||r.right>bounds.right+1||r.top<bounds.top-1||r.bottom>bounds.bottom+1)errors.push(`Outside page: ${word.textContent}`);
        if(word.textContent!==text.slice(from,to))errors.push(`Wrong offset: ${from} ${word.textContent}`);
      }
    }
    return {errors:errors.slice(0,10),words,widths:[...widths]};
  },text);
  report.geometry=await geometry();expect(report.geometry.errors).toEqual([]);expect(report.geometry.widths.length).toBe(2);
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true});
  await editor.press('Control+End');await editor.pressSequentially(' EDITED');await editor.press('Control+z');
  await expect(editor).not.toContainText('EDITED');await expect.poll(()=>sheets.count()).toBe(report.pages);
  await editor.locator('p').filter({hasText:'SECOND_BODY'}).click();
  await page.getByRole('button',{name:'More formatting',exact:true}).click();
  await page.getByRole('menuitem',{name:'Section properties…',exact:true}).click();
  const section=page.getByRole('dialog',{name:'Section',exact:true});
  await section.getByLabel('Section paper').selectOption('A4');await section.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(async()=>(await geometry()).widths.length).toBe(1);expect((await geometry()).errors).toEqual([]);
  await editor.press('Control+z');await expect.poll(async()=>(await geometry()).widths.length).toBe(2);
  await expect.poll(()=>sheets.count()).toBe(report.pages);
  for(const scale of ['0.5','1','1.5']){
    await page.keyboard.press('Control+,');const settings=page.getByRole('dialog',{name:'Settings',exact:true});
    await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(scale);await settings.getByRole('button',{name:'Done',exact:true}).click();
    await expect.poll(()=>sheets.count()).toBe(report.pages);expect((await geometry()).errors).toEqual([]);
  }
  await expect(page.locator('.save-status')).toHaveText('Saved');await reopen();
  await expect.poll(()=>sheets.count()).toBe(report.pages);expect((await geometry()).errors).toEqual([]);
  await page.getByRole('tab',{name:'Pages',exact:true}).click();await expect(page.locator('.page-card')).toHaveCount(report.pages);
  await page.getByRole('tab',{name:'Write',exact:true}).click();
  const outputs={footnotesExpected:1,skipListNumbers:true,expectedText:['FIRST_BODY','SECOND_BODY','THIRD_BODY']};
  for(const format of ['pdf']){
    const output=await page.evaluate(async({id,format})=>{const result=await window.alder.request('POST',`/api/projects/${id}/export`,{format});return {result,bytes:[...new Uint8Array(await(await fetch(window.alder.mediaBase+result.downloadUrl)).arrayBuffer())]};},{id,format});
    const file=path.join(directory,'alder.'+format);fs.writeFileSync(file,Buffer.from(output.bytes));outputs[format]={...output.result,path:file};
  }
  const error=await page.evaluate(async id=>{try{await window.alder.request('POST',`/api/projects/${id}/export`,{format:'docx'});return '';}catch(e){return e.message;}},id);
  expect(error).toContain('Word can clip footnotes');report.wordExport='refused unsafe changing-geometry continuation';
  fs.writeFileSync(path.join(directory,'fixture-exports.json'),JSON.stringify(outputs));
  await page.screenshot({path:path.join(directory,'write.png')});expect(report.errors).toEqual([]);report.status='passed';
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));await app?.close();}
