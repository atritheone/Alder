import {_electron as electron,expect as baseExpect} from '@playwright/test';
import {desktopExecutable} from './desktop-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const pictures=process.env.ALDER_NOTE_PICTURES==='1';
const headerMerge=process.env.ALDER_NOTE_HEADER_MERGE==='1';
const merged=process.env.ALDER_NOTE_MERGED==='1';
const tables=headerMerge||merged||process.env.ALDER_NOTE_TABLES==='1';
const outline=process.env.ALDER_NOTE_OUTLINE==='1';
const lists=outline||process.env.ALDER_NOTE_LISTS==='1';
const expect=baseExpect.configure({timeout:45000}),directory=path.resolve(headerMerge?'work/note-header-merge-widths-ui':merged?'work/note-merged-widths-ui':tables?'work/note-table-widths-ui':outline?'work/note-outline-widths-ui':lists&&pictures?'work/note-mixed-widths-ui':lists?'work/note-list-widths-ui':pictures?'work/note-picture-widths-ui':'work/note-widths-ui'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'alder-note-widths-'));
fs.mkdirSync(directory,{recursive:true});
let text=Array.from({length:400},(_,i)=>`NOTE${String(i).padStart(4,'0')} A footnote can follow changing page widths. `).join('');
const report={status:'running',errors:[]};let app,page;
try{
  app=await electron.launch({executablePath:desktopExecutable(),args:['.','--headless-test',`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
  page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.getByRole('button',{name:'New',exact:true}).waitFor();
  const fixture=await page.evaluate(async ({text,picture,lists,outline,tables,merged,headerMerge})=>{
    const p=await window.alder.request('POST','/api/projects',{name:'Changing note widths',template:'blank'});
    p.settings={...p.settings,documentKind:'docx',includeTitle:false,pageSize:'A4',marginMm:20};
    const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]});
    let content=[paragraph(text)],imageCount=0,image;
    if(picture){
      const asset=await window.alder.upload(`/api/projects/${p.id}/assets?register=false`,'sample.png',[...Uint8Array.from(atob(picture),c=>c.charCodeAt(0))],{});
      p.assets=[asset];
      image=(block=false)=>({type:block?'image':'inline_image',attrs:{blockId:`note_picture_${imageCount}`,assetId:asset.id,src:`/api/projects/${p.id}/assets/${asset.id}`,alt:`NOTE_PICTURE_${imageCount++}`,width:80}});
      // Eight large inline pictures share offset zero and must continue onto
      // the narrower second sheet before any authored wording is encountered.
      content=[{type:'paragraph',content:Array.from({length:8},()=>{const node=image();node.attrs.width=360;return node;})}];
      for(let i=0;i<20;i++){
        const words=Array.from({length:20},(_,j)=>`NOTE${String(i*20+j).padStart(4,'0')} A footnote can follow changing page widths. `).join('');
        const p=paragraph(words);
        if(i%4===0)p.content.splice(0,0,image(),image());
        content.push(p);
        if(i%4===2)content.push(image(true));
      }
      text=content.map(block=>(block.content||[]).map(node=>node.text||'').join('')).join('\n');
    }
    if(lists){
      const words=(start,count)=>paragraph(Array.from({length:count},(_,j)=>`NOTE${String(start+j).padStart(4,'0')} A footnote can follow changing page widths. `).join(''));
      const item=(...content)=>({type:'list_item',content});
      content=[{type:'ordered_list',attrs:{order:4},content:[item(words(0,120),{type:'ordered_list',attrs:{order:7},content:[item(words(120,20)),item(words(140,20))]}),item(words(160,40))]},
        {type:'bullet_list',content:Array.from({length:5},(_,i)=>item(words(200+i*40,40)))}];
      if(image){
        imageCount=0;
        const first=content[0].content[0].content[0];
        first.content.unshift(...Array.from({length:8},()=>{const node=image();node.attrs.width=360;return node;}));
        content[0].content[0].content[1].content[0].content[0].content.push(image());
        content[0].content[0].content[1].content[1].content.push(image(true));
      }
      if(outline){
        const template=Array.from({length:9},(_,i)=>({format:'decimal',pattern:Array.from({length:i+1},(_,n)=>`%${n+1}`).join('.')+'.',start:1,restart:i,indent:24*(i+1),hanging:18}));
        template[1]={...template[1],format:'lower-alpha',pattern:'%1(%2)',start:7,restart:0};
        content[0].attrs.listTemplate=template;
        content[1].type='ordered_list';content[1].attrs={listTemplate:template,continuePrevious:true};
        content[1].content[0]=item(words(200,20),{type:'ordered_list',content:[item(words(220,20))]});
      }
      const project=node=>node.type==='text'?node.text||'':(node.content||[]).map(project).join(node.type==='paragraph'?'':'\n');
      text=project({type:'doc',content});
    }
    if(tables){
      const words=(start,count)=>paragraph(Array.from({length:count},(_,j)=>`NOTE${String(start+j).padStart(4,'0')} A footnote can follow changing page widths. `).join(''));
      const cell=(...content)=>({type:'table_cell',content}),row=(...content)=>({type:'table_row',content});
      const left=words(0,120),right=words(120,160);left.attrs={fontSize:12};
      if(image){imageCount=0;left.content.unshift(image(),image());right.content.unshift(image(),image());}
      content=[{type:'table',content:[
        row({...cell(paragraph('LEFT_HEADING')),type:'table_header'},{...cell(paragraph('RIGHT_HEADING')),type:'table_header'}),
        row(cell(left),cell(right)),
        row({...cell(words(280,40)),attrs:{colspan:2}}),
        row(cell({type:'table',content:[row(cell(words(320,20)),cell(words(340,20)))]}),cell({type:'ordered_list',attrs:{order:3},content:[{type:'list_item',content:[words(360,20)]},{type:'list_item',content:[words(380,20)]}]})),
      ]}];
      if(merged){
        content[0].content[1].content[0].attrs={rowspan:2};
        const pictures=right.content.filter(node=>node.type==='inline_image');
        right.content=[...pictures,...words(120,80).content];
        content[0].content.splice(2,0,row(cell(words(200,80))));
      }
      if(headerMerge){
        // The first header band can repeat; the next heading's merge crosses
        // into a body row and must continue as one grid without repeating ink.
        content[0].content.splice(1,1,
          row({...cell(left),type:'table_header',attrs:{rowspan:2}},{...cell(paragraph('MERGED_HEADING')),type:'table_header'}),
          row(cell(right)));
      }
      const project=node=>node.type==='text'?node.text||'':(node.content||[]).map(project).join(node.type==='paragraph'?'':node.type==='table_row'?'\t':'\n');
      text=project({type:'doc',content});
    }
    p.book={version:1,chapters:[{id:'main',title:'Text',include:true,document:{type:'doc',content:[
      {type:'paragraph',content:[{type:'text',text:'FIRST_BODY '},{type:'document_note',attrs:{blockId:'long-note',kind:'footnote',body:{type:'doc',content}}}]},
      {type:'section_break',attrs:{kind:'nextPage',page:{pageSize:'A5',marginMm:20}}},paragraph('SECOND_BODY'),
      {type:'section_break',attrs:{kind:'nextPage',page:{pageSize:'A4',marginMm:20}}},paragraph('THIRD_BODY'),
    ]}}]};
    await window.alder.request('PUT',`/api/projects/${p.id}`,{project:p,expectedRevision:p.revision});return {id:p.id,text,imageCount};
  },{text,lists,outline,tables,merged,headerMerge,picture:pictures?JSON.parse(fs.readFileSync('work/note-images-word/fixture-project.json','utf8')).assets[0].data:null});
  const id=fixture.id;text=fixture.text;report.images=fixture.imageCount;
  const reopen=async()=>{await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();await page.locator('.project-list-item').filter({hasText:'Changing note widths'}).click();};
  await reopen();const sheets=page.locator('.page-sheets > .page-sheet');
  await expect(sheets.locator('[data-note-fragment]')).not.toHaveCount(0);
  await expect.poll(()=>sheets.count()).toBeGreaterThan(3);
  report.pages=await sheets.count();
  const geometry=()=>sheets.evaluateAll((pages,{text,tables})=>{
    const errors=[],widths=new Set(),images=[],markers=[];let words=0;
    for(const page of pages){
      const bounds=page.getBoundingClientRect();widths.add(Math.round(bounds.width));
      for(const word of page.querySelectorAll('[data-note-from]')){
        const r=word.getBoundingClientRect(),from=Number(word.dataset.noteFrom),to=Number(word.dataset.noteTo);words++;
        if(r.left<bounds.left-1||r.right>bounds.right+1||r.top<bounds.top-1||r.bottom>bounds.bottom+1)errors.push(`Outside page: ${word.textContent}`);
        if(word.textContent!==text.slice(from,to))errors.push(`Wrong offset: ${from} ${word.textContent}`);
      }
      for(const image of page.querySelectorAll('[data-note-fragment] img')){
        images.push(image.alt);const r=image.getBoundingClientRect();
        if(r.left<bounds.left-1||r.right>bounds.right+1||r.top<bounds.top-1||r.bottom>bounds.bottom+1)errors.push(`Outside page: ${image.alt}`);
        if(!image.complete||!image.naturalWidth)errors.push(`Unloaded: ${image.alt}`);
      }
      markers.push(...[...page.querySelectorAll('[data-note-list-marker]')].map(node=>node.textContent.trim()).filter(Boolean));
    }
    return {errors:errors.slice(0,10),words,widths:[...widths],images:tables?images.sort():images,markers};
  },{text,tables});
  if(pictures)await expect.poll(async()=>{report.geometry=await geometry();return report.geometry.images.length;}).toBe(fixture.imageCount);
  report.geometry=await geometry();expect(report.geometry.errors).toEqual([]);expect(report.geometry.widths.length).toBe(2);
  const expectedImages=Array.from({length:fixture.imageCount},(_,i)=>`NOTE_PICTURE_${i}`);
  if(tables)expectedImages.sort();
  expect(report.geometry.images).toEqual(expectedImages);
  const expectedMarkers=tables?['3.','4.']:outline?['4.','4(g)','4(h)','5.','6.','6(i)','7.','8.','9.','10.']:lists?['4.','7.','8.','5.',...Array(5).fill('•')]:[];
  expect(report.geometry.markers).toEqual(expectedMarkers);
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
    await expect.poll(()=>sheets.count()).toBe(report.pages);expect((await geometry()).errors).toEqual([]);expect((await geometry()).images).toEqual(expectedImages);expect((await geometry()).markers).toEqual(expectedMarkers);
  }
  await expect(page.locator('.save-status')).toHaveText('Saved');await reopen();
  await expect.poll(()=>sheets.count()).toBe(report.pages);expect((await geometry()).errors).toEqual([]);expect((await geometry()).images).toEqual(expectedImages);expect((await geometry()).markers).toEqual(expectedMarkers);
  await page.getByRole('tab',{name:'Pages',exact:true}).click();await expect(page.locator('.page-card')).toHaveCount(report.pages);
  await page.getByRole('tab',{name:'Write',exact:true}).click();
  const outputs={footnotesExpected:1,skipListNumbers:true,images:fixture.imageCount,listMarkers:expectedMarkers.filter(marker=>marker!=='•'),expectedText:['FIRST_BODY','SECOND_BODY','THIRD_BODY']};
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
