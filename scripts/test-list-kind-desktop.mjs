// Generate list-kind-revisions-fixture.py first; this uses the existing toolbar.
import {_electron as electron,expect} from '@playwright/test';
import {desktopExecutable} from './desktop-paths.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const input=path.resolve(process.argv[2]);
const fixture=JSON.parse(fs.readFileSync(path.join(input,'fixture-inputs.json'),'utf8'));
const source=JSON.parse(fs.readFileSync(path.join(input,'fixture-project.json'),'utf8'));
const directory=path.join(path.dirname(input),path.basename(input).replace(/-word$/,'')+'-editing-ui');fs.mkdirSync(directory,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-list-kind-'));
const report={status:'running',errors:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
  await expect(page.getByRole('button',{name:'New',exact:true})).toBeVisible();
  const saved=await page.evaluate(async({fixture,source})=>{
    let p=await window.alder.request('POST','/api/projects',{name:'List conversion',template:'blank'});
    p.settings=source.settings;p.book={version:1,chapters:[{id:'main',title:'Text',include:true,document:fixture.original}]};
    return window.alder.request('PUT',`/api/projects/${p.id}`,{project:p,expectedRevision:p.revision});
  },{fixture,source});
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'List conversion'}).click();
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(1440,1000);w.show();w.focus();});
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true});
  const toolbar=page.locator('.book-main .format-toolbar');
  const menu=async name=>{await toolbar.getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();};
  const review=page.getByRole('dialog',{name:'Review changes',exact:true});
  await menu('Review changes…');await review.getByLabel('Review author',{exact:true}).fill('Reviewer');await review.getByLabel('Track changes',{exact:true}).check();await review.getByRole('button',{name:'Done',exact:true}).click();
  const paragraph=editor.locator('p').filter({hasText:fixture.conversionChange?/OUTLINE_A$/:fixture.outlineChange?(fixture.outlineChange.level===0?/OUTLINE_A$/:/OUTLINE_a$/):/^First item$/});await paragraph.click();await page.keyboard.press('Home');await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');
  const before=await paragraph.evaluate(el=>el.closest('ol,ul').tagName);
  if(fixture.conversionChange){
    await menu('List…');const dialog=page.getByRole('dialog',{name:'List',exact:true});
    await dialog.getByLabel('List structure',{exact:true}).selectOption(fixture.conversionChange.reverse?'ordinary':'outline');
    if(!fixture.conversionChange.reverse){
      for(const [level,spec] of fixture.conversionChange.template.entries()){
        await dialog.getByLabel('Outline level',{exact:true}).selectOption({value:String(level)});
        await dialog.getByLabel('Outline number format',{exact:true}).selectOption(spec.format);
        await dialog.getByLabel('Outline number pattern',{exact:true}).fill(spec.pattern);
        if(level){await dialog.getByLabel('Outline level start',{exact:true}).fill(String(spec.start));await dialog.getByLabel('Outline restart',{exact:true}).selectOption({value:String(spec.restart)});}
        await dialog.getByLabel('Outline indent',{exact:true}).fill(String(spec.indent));await dialog.getByLabel('Outline hanging indent',{exact:true}).fill(String(spec.hanging));
      }
    }
    await dialog.getByRole('button',{name:'Apply',exact:true}).click();
    await expect(editor.locator('.outline-list-number')).toHaveText(fixture.numberLabels.final);
  }else if(fixture.outlineChange){
    const {level,reverse}=fixture.outlineChange;await menu('List…');const dialog=page.getByRole('dialog',{name:'List',exact:true});
    await dialog.getByLabel('Outline level',{exact:true}).selectOption({value:String(level)});await dialog.getByLabel('Outline number format',{exact:true}).selectOption(reverse?'upper-alpha':'square');await dialog.getByLabel('Outline number pattern',{exact:true}).fill(reverse?`%${level+1}.`:'▪');await dialog.getByRole('button',{name:'Apply',exact:true}).click();
    await expect(editor.locator('.outline-list-number')).toHaveText(fixture.numberLabels.final);
  }else await toolbar.getByRole('button',{name:before==='OL'?'Bullet list':'Numbered list',exact:true}).click();
  const pending=editor.locator('[data-revision-paragraph]');await expect.poll(()=>pending.count()).toBeGreaterThan(0);const pendingCount=await pending.count();
  const after=fixture.conversionChange?before:before==='OL'?'UL':'OL';
  expect(await paragraph.evaluate(el=>el.closest('ol,ul').tagName)).toBe(after);
  expect(await page.evaluate(()=>getSelection()?.toString())).toBe(fixture.outlineChange||fixture.conversionChange?'O':'F');
  await editor.press('Control+z');await expect(pending).toHaveCount(0);expect(await paragraph.evaluate(el=>el.closest('ol,ul').tagName)).toBe(before);
  await editor.press('Control+y');await expect(pending).toHaveCount(pendingCount);
  if(fixture.comments){await menu('Comments…');const comments=page.getByRole('dialog',{name:'Comments',exact:true});await expect(comments.getByRole('listitem')).toHaveCount(1);await expect(comments).not.toContainText('Anchor incomplete');await comments.getByRole('button',{name:'Close',exact:true}).click();}
  for(const scale of ['0.5','1.5','1']){
    await page.keyboard.press('Control+,');const settings=page.getByRole('dialog',{name:'Settings',exact:true});await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(scale);await settings.getByRole('button',{name:'Close settings',exact:true}).click();
    await menu('Review changes…');await expect(review.locator('.review-list>button')).toHaveCount(1);expect(await review.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})).toBe(true);await review.getByRole('button',{name:'Done',exact:true}).click();
  }
  for(const decision of ['Reject','Accept']){
    await menu('Review changes…');await review.getByRole('button',{name:decision,exact:true}).click();await review.getByRole('button',{name:'Done',exact:true}).click();await expect(pending).toHaveCount(0);
    expect(await paragraph.evaluate(el=>el.closest('ol,ul').tagName)).toBe(decision==='Reject'?before:after);
    if(fixture.outlineChange||fixture.conversionChange)await expect(editor.locator('.outline-list-number')).toHaveText(fixture.numberLabels[decision==='Reject'?'original':'final']);
    await editor.press('Control+z');await expect(pending).toHaveCount(pendingCount);
  }
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const exported=await page.evaluate(async id=>{const source=await window.alder.request('GET',`/api/projects/${id}`);const result=await window.alder.request('POST',`/api/projects/${id}/export`,{format:'docx'});const response=await fetch(window.alder.mediaBase+result.downloadUrl);return{source,result,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};},saved.id);
  const file=path.join(directory,'alder.docx');fs.writeFileSync(file,Buffer.from(exported.bytes));fs.writeFileSync(path.join(directory,'fixture-project.json'),JSON.stringify(exported.source));fs.writeFileSync(path.join(directory,'fixture-exports.json'),JSON.stringify({docx:{...exported.result,path:file},reviewDecisions:true,skipListNumbers:true,expectedText:[fixture.outlineChange||fixture.conversionChange?'OUTLINE_A':'First item']}));
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'List conversion'}).click();await expect(pending).toHaveCount(pendingCount);
  await page.screenshot({path:path.join(directory,'conversion.png')});expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);process.exitCode=1;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));if(report.status==='failed')await app?.evaluate(({app})=>app.exit(1)).catch(()=>{});await app?.close().catch(()=>{});}
