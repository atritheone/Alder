// Generate structured-comparison-fixture.py first, then pass its directory.
import { _electron as electron, expect } from '@playwright/test';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const input=path.resolve(process.argv[2]||'work/structured-comparison-word');
const fixture=JSON.parse(fs.readFileSync(path.join(input,'fixture-inputs.json'),'utf8'));
const editContinuation=process.argv.includes('--edit-list-continuation');
const editConversion=process.argv.includes('--edit-list-conversion'),editing=editContinuation||editConversion;
const combining=!!fixture.combining,title=combining?'Combine reviewed copies':'Compare documents',resultName=editing?'original':combining?'original - combined review':'original - comparison';
const directory=path.join(path.dirname(input),path.basename(input).replace(/-word$/,'')+(editing?'-editing':'')+'-ui');fs.mkdirSync(directory,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-structure-compare-'));
const report={status:'running',errors:[]};let app,page;
const authored=locator=>locator.evaluate(el=>{const copy=el.cloneNode(true);copy.querySelectorAll('.outline-list-number').forEach(n=>n.remove());return copy.textContent;});
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));
  await expect(page.getByRole('button',{name:'New',exact:true})).toBeVisible();
  const sources=await page.evaluate(async fixture=>{
    const copies=[];
    for(const side of ['original','revised']){
      const p=await window.alder.request('POST','/api/projects',{name:side,template:'blank'});
      p.settings.documentKind='docx';p.settings.includeTitle=false;
      p.book={version:1,chapters:[{id:'main',title:'Text',include:true,document:fixture[side]}]};
      copies.push(await window.alder.request('PUT',`/api/projects/${p.id}`,{project:p,expectedRevision:p.revision}));
    }
    return copies;
  },fixture);
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'original'}).first().click();
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(1440,1000);w.show();w.focus();});
  const editor=page.getByRole('textbox',{name:'Chapter text editor',exact:true});
  const menu=async name=>{await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();};
  const dialog=page.getByRole('dialog',{name:title,exact:true});
  for(const scale of ['0.5','1.5','1']){
    await page.keyboard.press('Control+,');const settings=page.getByRole('dialog',{name:'Settings',exact:true});await settings.getByRole('tab',{name:'Appearance',exact:true}).click();await settings.getByLabel('UI Scale',{exact:true}).selectOption(scale);await settings.getByRole('button',{name:'Close settings',exact:true}).click();
    await menu(title+'…');expect(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})).toBe(true);await page.keyboard.press('Escape');
  }
  if(editing){
    const roots=doc=>[...((editConversion?['ordered_list','bullet_list'].includes(doc.type):doc.attrs?.listTemplate)?[doc]:[]),...(doc.content||[]).flatMap(roots)];
    const before=roots(fixture.original),after=roots(fixture.revised);
    const target=before.findIndex((node,i)=>editConversion?!!node.attrs?.listTemplate!==!!after[i].attrs?.listTemplate:!!node.attrs.continuePrevious!==!!after[i].attrs.continuePrevious);
    expect(target).toBeGreaterThanOrEqual(0);
    await menu('Review changes…');const review=page.getByRole('dialog',{name:'Review changes',exact:true});await review.getByLabel('Review author',{exact:true}).fill('Reviewer');await review.getByLabel('Track changes',{exact:true}).check();await review.getByRole('button',{name:'Done',exact:true}).click();
    await editor.locator(editConversion?'ol,ul':'ol[data-list-template],ul[data-list-template]').nth(target).locator('p').first().click();await menu('List…');const list=page.getByRole('dialog',{name:'List',exact:true});
    if(editConversion){
      const template=after[target].attrs?.listTemplate;
      await list.getByLabel('List structure',{exact:true}).selectOption(template?'outline':'ordinary');
      if(template){
        if(await list.getByLabel('Outline scope',{exact:true}).count())await list.getByLabel('Outline scope',{exact:true}).selectOption('current');
        for(const [i,spec] of template.entries()){
          await list.getByLabel('Outline level',{exact:true}).selectOption({value:String(i)});await expect(list.getByLabel('Outline level',{exact:true})).toHaveValue(String(i));
          await list.getByLabel('Outline number format',{exact:true}).selectOption(spec.format);
          await list.getByLabel('Outline number pattern',{exact:true}).fill(spec.pattern);
          await list.getByLabel('Outline level start',{exact:true}).fill(String(i===0?after[target].attrs.order:spec.start));
          if(i)await list.getByLabel('Outline restart',{exact:true}).selectOption({value:String(spec.restart)});
          await list.getByLabel('Outline indent',{exact:true}).fill(String(spec.indent));
          await list.getByLabel('Outline hanging indent',{exact:true}).fill(String(spec.hanging));
        }
      }else{
        await list.getByLabel('List markers',{exact:true}).selectOption(after[target].attrs.listStyle||'decimal');
      }
    }
    await list.getByLabel('List numbering',{exact:true}).selectOption(after[target].attrs.continuePrevious?'continue':'restart');
    if(!after[target].attrs.continuePrevious){
      if(after[target].attrs.listTemplate){await list.getByLabel('Outline level',{exact:true}).selectOption('0');await list.getByLabel('Outline level start',{exact:true}).fill(String(after[target].attrs.order));}
      else await list.getByLabel('List start',{exact:true}).fill(String(after[target].attrs.order));
    }
    await list.getByRole('button',{name:'Apply',exact:true}).click();
  }else{
  await menu(title+'…');await dialog.getByLabel(combining?'Second reviewed copy':'Revised document',{exact:true}).selectOption(sources[1].id);if(!combining)await dialog.getByLabel('Comparison author',{exact:true}).fill('Reviewer');await dialog.getByRole('button',{name:'Preview',exact:true}).click();
  for(const conflict of fixture.conflicts||[]){
    await expect(dialog.getByRole('button',{name:'Create reviewed copy',exact:true})).toBeDisabled();
    const choice=dialog.getByLabel(`Keep review at ${conflict.location}`,{exact:true});
    await choice.selectOption(conflict.choice);await expect(choice).toBeEnabled();await expect(choice).toHaveValue(conflict.choice);
  }
  await expect(dialog.getByLabel('Comparison summary',{exact:true})).toContainText(`${fixture.changes} change${fixture.changes===1?'':'s'}`);
  await dialog.getByRole('button',{name:'Create reviewed copy',exact:true}).click();await expect(dialog).not.toBeVisible();
  }
  if(fixture.comments){
    await menu('Comments…');const comments=page.getByRole('dialog',{name:'Comments',exact:true});
    await expect(comments.getByRole('listitem')).toHaveCount(fixture.comments);await expect(comments).not.toContainText('Anchor incomplete');await comments.getByRole('button',{name:'Close',exact:true}).click();
  }
  await expect(page.locator('.save-status')).toHaveText('Saved');
  for(const source of editing?sources.slice(1):sources){const saved=await page.evaluate(id=>window.alder.request('GET',`/api/projects/${id}`),source.id);expect(saved).toEqual(source);}
  const review=page.getByRole('dialog',{name:'Review changes',exact:true});
  for(const [decision,view] of [['Reject','original'],['Accept','final']]){
    await menu('Review changes…');await expect(review.locator('.review-list>button')).toHaveCount(fixture.changes);await review.getByLabel('Review preview',{exact:true}).selectOption(view);
    const preview=review.getByLabel(`${view} document preview`,{exact:true});await expect.poll(()=>authored(preview)).toBe(fixture.text[view].replace(/[\n\t]/g,''));
    if(fixture.numberLabels?.[view]?.length)await expect(preview.locator('.outline-list-number')).toHaveText(fixture.numberLabels[view]);
    await review.getByLabel('Review scope',{exact:true}).selectOption('all');await review.getByRole('button',{name:decision,exact:true}).click();await review.getByRole('button',{name:'Done',exact:true}).click();
    await expect.poll(()=>authored(editor)).toBe(fixture.text[view].replace(/[\n\t]/g,''));if(fixture.numberLabels?.[view]?.length)await expect(editor.locator('.outline-list-number')).toHaveText(fixture.numberLabels[view]);await editor.press('Control+z');
  }
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const exported=await page.evaluate(async resultName=>{const list=await window.alder.request('GET','/api/projects');const item=list.projects.find(p=>p.name===resultName);const source=await window.alder.request('GET',`/api/projects/${item.id}`);const result=await window.alder.request('POST',`/api/projects/${source.id}/export`,{format:'docx'});const response=await fetch(window.alder.mediaBase+result.downloadUrl);return{source,result,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};},resultName);
  const file=path.join(directory,'alder.docx');fs.writeFileSync(file,Buffer.from(exported.bytes));fs.writeFileSync(path.join(directory,'fixture-project.json'),JSON.stringify(exported.source));fs.writeFileSync(path.join(directory,'fixture-exports.json'),JSON.stringify({docx:{...exported.result,path:file},reviewDecisions:true,skipListNumbers:true,expectedText:fixture.expectedText||['Anchor']}));
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:resultName}).first().click();await menu('Review changes…');await expect(review.locator('.review-list>button')).toHaveCount(fixture.changes);await review.getByRole('button',{name:'Done',exact:true}).click();
  await page.screenshot({path:path.join(directory,'comparison.png')});expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);process.exitCode=1;await page?.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));if(report.status==='failed')await app?.evaluate(({app})=>app.exit(1)).catch(()=>{});await app?.close().catch(()=>{});}
