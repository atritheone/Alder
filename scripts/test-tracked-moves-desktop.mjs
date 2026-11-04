import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const boxes = process.argv.includes("--text-boxes");
const notes = process.argv.includes("--notes");
const fields = process.argv.includes("--fields");
const references = process.argv.includes("--references");
const indexes = process.argv.includes("--indexes");
const citations = process.argv.includes("--citations");
const sequences = process.argv.includes("--sequences");
const captions = process.argv.includes("--captions");
const bookmarks = process.argv.includes("--bookmarks");
const comments = process.argv.includes("--comments");
const outlineLists = process.argv.includes("--outline-lists");
const listParagraphs = process.argv.includes("--list-paragraphs");
const structuralObjects = process.argv.includes("--structural-objects");
const structuralFields = process.argv.includes("--structural-fields");
const structuralControls = process.argv.includes("--structural-controls");
const structuralGenerated = process.argv.includes("--structural-generated");
const lists = listParagraphs || outlineLists || process.argv.includes("--lists");
const tables = process.argv.includes("--tables");
const forms = process.argv.includes("--forms");
const shapes = process.argv.includes("--shapes");
const pictures = captions || process.argv.includes("--pictures"),
  equations = process.argv.includes("--equations"),
  section = tables || lists || process.argv.includes("--section"),
  block = comments || bookmarks || sequences || citations || indexes || references || fields || notes || boxes || forms || shapes || equations || pictures || section || process.argv.includes("--blocks"),
  selector = block ? "[data-revision-block-move]" : "[data-revision-move=true]",
  count = tables ? 6 : section || captions ? 4 : 2;
let original = section
  ? "IntroductionFirst section.ConclusionLast section."
  : "Alpha sentence. Beta sentence.Gamma sentence. Delta sentence.";
const directory = comments ? path.resolve(`work/tracked-${tables?'table':lists?'list':'paragraph'}-comments-ui`) : path.resolve(
    ...(bookmarks&&section ? [tables ? "work/tracked-table-bookmarks-ui" : "work/tracked-list-bookmarks-ui"] : structuralGenerated ? [tables ? "work/tracked-table-generated-ui" : "work/tracked-list-generated-ui"] : structuralControls ? [tables ? "work/tracked-table-controls-ui" : "work/tracked-list-controls-ui"] : structuralFields ? [tables ? "work/tracked-table-fields-ui" : "work/tracked-list-fields-ui"] : structuralObjects ? [tables ? "work/tracked-table-objects-ui" : "work/tracked-list-objects-ui"] : tables ? ["work/tracked-table-moves-ui"] : lists ? [listParagraphs ? "work/tracked-list-paragraphs-ui" : outlineLists ? "work/tracked-outline-list-moves-ui" : "work/tracked-list-moves-ui"] : [
    bookmarks ? "work/tracked-bookmark-moves-ui" : captions ? "work/tracked-caption-moves-ui" : sequences ? "work/tracked-sequence-moves-ui" : citations ? "work/tracked-citation-moves-ui" : indexes ? "work/tracked-index-moves-ui" : references ? "work/tracked-reference-moves-ui" : fields ? "work/tracked-field-moves-ui" : notes ? "work/tracked-note-moves-ui" : boxes ? "work/tracked-text-box-moves-ui" : forms ? "work/tracked-form-moves-ui" : shapes ? "work/tracked-shape-moves-ui" : equations ? "work/tracked-equation-moves-ui" : pictures ? "work/tracked-picture-moves-ui" : section
      ? "work/tracked-section-moves-ui"
      : block
        ? "work/tracked-block-moves-ui"
        : "work/tracked-moves-ui"]),
  ),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-moves-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", errors: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Tracked moves");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    dialog = page.getByRole("dialog", { name: "Review changes", exact: true });
  await expect(editor).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  const open = async () => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Review changes…", exact: true })
      .click();
  };
  const close = async () =>
    dialog.getByRole("button", { name: "Done", exact: true }).click();
  await editor.fill("Alpha sentence. Beta sentence.");
  await editor.press("Control+End");
  await editor.press("Enter");
  await editor.pressSequentially("Gamma sentence. Delta sentence.");
  const images=editor.locator('img:not(.ProseMirror-separator)');
  const fieldNodes=editor.locator('[data-document-field]');let fieldText;
  const sequenceNodes=editor.locator('[data-document-sequence]');
  const bookmarkNodes=editor.locator('[data-document-bookmark]');let bookmarkId;
  const openBookmarks=async()=>{
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Bookmarks…',exact:true}).click();
    return page.getByRole('dialog',{name:'Document bookmarks',exact:true});
  };
  if(bookmarks){
    await editor.press('Control+Home');await editor.press('Shift+End');
    const properties=await openBookmarks();
    await properties.getByRole('textbox',{name:'Bookmark name',exact:true}).fill('Passage');
    await properties.getByRole('button',{name:'Add',exact:true}).click();
    await expect(bookmarkNodes).toHaveCount(1);bookmarkId=await bookmarkNodes.getAttribute('data-bookmark-id');
  }
  if(sequences){
    await editor.press('Control+a');
    await editor.evaluate(el=>{
      const data=new DataTransfer();
      data.setData('text/html','<p data-caption-label="Figure">Alpha sentence. Beta sentence. Figure <span data-document-sequence="Figure">1</span></p><p data-caption-label="Figure">Gamma sentence. Delta sentence. Figure <span data-document-sequence="Figure">2</span></p>');
      el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    });
    await expect(sequenceNodes).toHaveText(['1','2']);original=await editor.textContent();
  }
  const referenceNodes=editor.locator('[data-cross-reference]');let referenceTarget;
  const indexNodes=editor.locator('[data-index-entry]');let indexBefore;
  const citationNodes=editor.locator('[data-document-citation]');let citationBefore,citationText;
  if(citations){
    await editor.press('Control+Home');await editor.press('End');
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Sources…',exact:true}).click();
    const properties=page.getByRole('dialog',{name:'Sources',exact:true});
    await properties.getByRole('button',{name:'New source',exact:true}).click();
    await properties.getByLabel('Source title',{exact:true}).fill('Moved source');
    await properties.getByLabel('Source authors',{exact:true}).fill('Smith, Alex');
    await properties.getByLabel('Source year',{exact:true}).fill('2020');
    await properties.getByRole('button',{name:'Save source',exact:true}).click();
    await properties.locator('.source-name').filter({hasText:'Moved source'}).click();
    await properties.getByLabel('Locator 1',{exact:true}).fill('12');
    await properties.getByRole('button',{name:'Insert citation',exact:true}).click();
    await expect(citationNodes).toHaveText('(Smith, 2020, p. 12)');
    citationBefore=JSON.parse(await citationNodes.getAttribute('data-document-citation'));citationText=await citationNodes.textContent();original=await editor.textContent();
  }
  if(indexes){
    await editor.press('Control+Home');await editor.press('End');
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Index entries…',exact:true}).click();
    const properties=page.getByRole('dialog',{name:'Index entries',exact:true});
    await properties.getByLabel('Main entry',{exact:true}).fill('Trees');
    await properties.getByLabel('Subentry',{exact:true}).fill('Alder');
    await properties.getByLabel('Index group',{exact:true}).selectOption('P');
    await properties.locator('summary').filter({hasText:/^Sorting$/}).click();
    await properties.getByLabel('Sort main entry as',{exact:true}).fill('Woodland');
    await properties.getByRole('button',{name:'Mark',exact:true}).click();
    await expect(indexNodes).toHaveCount(1);indexBefore=await indexNodes.getAttribute('data-index-id');
  }
  if(references){
    await editor.press('Control+Home');await editor.pressSequentially('Reference target');await editor.press('Enter');
    await editor.press('Control+Home');await page.getByLabel('Paragraph type',{exact:true}).selectOption('1');
    await editor.press('ArrowDown');await editor.press('End');
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Insert cross-reference…',exact:true}).click();
    const properties=page.getByRole('dialog',{name:'Insert cross-reference',exact:true});
    await properties.getByLabel('Reference target',{exact:true}).selectOption({index:1});
    await properties.getByRole('button',{name:'Insert',exact:true}).click();
    await expect(referenceNodes).toHaveCount(1);await expect(referenceNodes).toHaveText('Reference target');
    referenceTarget=await referenceNodes.getAttribute('data-cross-reference');original=await editor.textContent();
  }
  if(fields){
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Paragraph…',exact:true}).click();
    const paragraph=page.getByRole('dialog',{name:'Paragraph',exact:true});
    await paragraph.getByLabel('Page break before',{exact:true}).selectOption('true');
    await paragraph.getByRole('button',{name:'Apply',exact:true}).click();
    await editor.press('Control+Home');await editor.press('End');
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Insert field…',exact:true}).click();
    const properties=page.getByRole('dialog',{name:'Insert field',exact:true});
    await properties.getByLabel('Field',{exact:true}).selectOption('page');
    await properties.getByRole('button',{name:'Insert',exact:true}).click();
    await expect(fieldNodes).toHaveCount(1);await expect(fieldNodes).toHaveText('1');fieldText=await fieldNodes.textContent();
    // Retain authored ink on page one after moving the field paragraph away.
    await editor.press('Control+Home');await editor.pressSequentially('Opening context.');await editor.press('Enter');
    original=await editor.textContent();
  }
  const noteRefs=editor.locator('[data-document-note]');let noteBefore;
  if(notes){
    await editor.press('Control+Home');await editor.press('End');
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Notes…',exact:true}).click();
    const properties=page.getByRole('dialog',{name:'Notes',exact:true});
    await properties.getByRole('textbox',{name:'Note text',exact:true}).fill('Moved note wording.');
    await properties.getByRole('button',{name:'Insert',exact:true}).click();
    await expect(noteRefs).toHaveCount(1);noteBefore=JSON.parse(await noteRefs.first().getAttribute('data-document-note'));
    original=await editor.textContent();
  }
  let pictureBefore;
  if(pictures || structuralObjects){
    const data=structuralObjects?'iVBORw0KGgoAAAANSUhEUgAAAGAAAAAwCAIAAABhdOiYAAAAfklEQVR4nO3SMRHAIAAEQYgVjKAE/zKiAM7Abvvdzc+1z+Due2wI1DwoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgcbbDzqgASHKQA5AAAAAAElFTkSuQmCC':JSON.parse(fs.readFileSync(captions?'work/tracked-caption-moves-word/fixture-project.json':'work/tracked-picture-moves-word/fixture-project.json','utf8')).assets[0].data;
    const file=path.join(profile,'illustration.png');fs.writeFileSync(file,Buffer.from(data,'base64'));
    await editor.press('Control+Home');await editor.press('End');
    const choosing=page.waitForEvent('filechooser');
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'Insert image',exact:true}).click();
    await (await choosing).setFiles(file);await expect(images).toHaveCount(1);
    pictureBefore=await images.first().evaluate(el=>({id:el.dataset.objectId,src:el.dataset.imageSource||el.getAttribute('src'),alt:el.alt}));
    if(captions){
      await images.click({button:'right'});
      await page.getByRole('menuitem',{name:'Insert caption…',exact:true}).click();
      const caption=page.getByRole('dialog',{name:'Insert caption',exact:true});
      await caption.getByRole('textbox',{name:'Caption text',exact:true}).fill('Attached illustration.');
      await caption.getByRole('button',{name:'Insert',exact:true}).click();
      await expect(editor.locator('[data-caption-target]')).toHaveCount(1);
      original=await editor.textContent();
    }
  }
  const formulas=editor.locator('[data-equation]');let equationBefore;
  if(equations){
    await editor.press('Control+Home');await editor.press('End');
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Insert equation…',exact:true}).click();
    const properties=page.getByRole('dialog',{name:'Equation properties',exact:true});
    await expect(properties.locator('math-field')).toBeVisible();
    await properties.locator('math-field').evaluate(el=>{el.value=String.raw`\frac{a}{b}`;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));});
    await expect(properties.locator('.equation-preview math mfrac')).toBeVisible();
    await properties.getByLabel('Equation reading description').fill('Read fraction.');
    await properties.getByRole('button',{name:'Apply',exact:true}).click();
    await expect(formulas).toHaveCount(1);equationBefore=JSON.parse(await formulas.first().getAttribute('data-equation'));
    original=await editor.textContent();
  }
  const diagrams=editor.locator('[data-document-shape]');let shapeBefore;
  if(shapes){
    await editor.press('Control+Home');await editor.press('End');
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Insert shape…',exact:true}).click();
    const properties=page.getByRole('dialog',{name:'Shape properties',exact:true});
    await properties.getByLabel('Shape kind').selectOption('arrow');
    await properties.getByLabel('Shape description').fill('Moved diagram');
    await properties.getByRole('button',{name:'Apply',exact:true}).click();
    await expect(diagrams).toHaveCount(1);shapeBefore=JSON.parse(await diagrams.first().getAttribute('data-document-shape'));
  }
  const textBoxes=editor.locator('[data-text-box]');let boxBefore;
  if(boxes){
    await editor.press('Control+Home');await editor.press('End');
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Insert text box…',exact:true}).click();
    const properties=page.getByRole('dialog',{name:'Text box properties',exact:true});
    await properties.getByRole('textbox',{name:'Text box text',exact:true}).fill('Box value.');
    await properties.getByRole('button',{name:'Apply',exact:true}).click();
    await expect(textBoxes).toHaveCount(1);boxBefore=JSON.parse(await textBoxes.first().getAttribute('data-text-box'));
    original=await editor.textContent();
  }
  const controls=editor.locator('[data-form-field]');let formBefore;
  if(forms){
    await editor.press('Control+Home');await editor.press('End');
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Insert form field…',exact:true}).click();
    const properties=page.getByRole('dialog',{name:'Form field properties',exact:true});
    await properties.getByLabel('Field name',{exact:true}).fill('Moved field');
    await properties.getByLabel('Field text',{exact:true}).fill('Field value.');
    await properties.getByLabel('Lock content',{exact:true}).check();
    await properties.getByLabel('Prevent deletion',{exact:true}).check();
    await properties.getByRole('button',{name:'Apply',exact:true}).click();
    await expect(controls).toHaveCount(1);formBefore=JSON.parse(await controls.first().getAttribute('data-form-field'));
    original=await editor.textContent();
  }
  if (section) {
    await editor.press("Control+a");
    await editor.evaluate((el, { lists, outlineLists, listParagraphs, structuralObjects, structuralFields, structuralControls, structuralGenerated, bookmarks, pictureSource, tables }) => {
      const data = new DataTransfer();
      data.setData(
        "text/html",
        lists ? '<h1>Introduction</h1><ol start="3" style="list-style-type:upper-alpha"><li><p><strong>First item</strong></p><ul style="list-style-type:square"><li><p>Nested item</p></li></ul></li><li><p>Second item</p></li></ol><h1>Conclusion</h1><ol data-continue-list="true" style="list-style-type:upper-alpha"><li><p>Other item</p></li></ol>' : "<h1>Introduction</h1><p>First section.</p><h1>Conclusion</h1><p>Last section.</p>",
      );
      if(tables)data.setData('text/html','<h1>Introduction</h1><table data-object-id="grid"><tbody><tr><th colspan="2" data-colwidth="140,180" style="background:#ddeeff"><p>Merged header</p></th></tr><tr data-allow-split="true"><td data-colwidth="140" style="vertical-align:bottom"><ol start="3"><li><p><strong>List cell</strong></p></li></ol></td><td data-colwidth="180"><table><tbody><tr><td><p>Nested table</p></td></tr></tbody></table></td></tr></tbody></table><p data-caption-label="Table" data-caption-target="grid">Attached caption</p><h1>Conclusion</h1><p>Other section</p>');
      if(outlineLists){
        const template=Array.from({length:9},(_,i)=>({format:i===0?'upper-alpha':i===1?'lower-alpha':'decimal',pattern:i===1?'%1(%2)':Array.from({length:i+1},(_,n)=>`%${n+1}`).join('.')+'.',start:1,restart:i,indent:24*(i+1),hanging:18}));
        const html=new DOMParser().parseFromString(data.getData('text/html'),'text/html');
        for(const list of html.querySelectorAll('body > ol'))list.setAttribute('data-list-template',JSON.stringify(template));
        data.setData('text/html',html.body.innerHTML);
      }
      if(listParagraphs){
        const html=new DOMParser().parseFromString(data.getData('text/html'),'text/html');
        html.querySelector('ol > li').insertAdjacentHTML('beforeend','<p><em>Second paragraph</em></p><p></p>');
        html.querySelector('ul > li').insertAdjacentHTML('beforeend','<p>Nested continuation</p>');
        data.setData('text/html',html.body.innerHTML);
      }
      if(bookmarks){
        const html=new DOMParser().parseFromString(data.getData('text/html'),'text/html');
        const root=html.querySelector(tables?'table':'ol');const paragraphs=root.querySelectorAll('p');
        paragraphs[0].insertAdjacentHTML('afterbegin','<span data-document-bookmark="Passage" data-bookmark-id="passage" data-bookmark-range="true"></span>');
        paragraphs[paragraphs.length-1].insertAdjacentHTML('beforeend','<span data-bookmark-end="passage" data-bookmark-name="Passage"></span>');
        data.setData('text/html',html.body.innerHTML);
      }
      if(structuralGenerated){
        const html=new DOMParser().parseFromString(data.getData('text/html'),'text/html');
        if(lists){const following=html.querySelector('ol[data-continue-list]');following.removeAttribute('data-continue-list');following.setAttribute('start','7');}
        html.querySelectorAll('h1')[1].setAttribute('data-block-id','reference-target');
        const paragraph=html.querySelector(tables?'td p':'ol > li > p');
        paragraph.insertAdjacentHTML('beforeend',' Figure <span data-document-sequence="Figure">1</span> <span data-cross-reference="reference-target">Conclusion</span>');
        const entry=html.createElement('span');entry.dataset.indexEntry=JSON.stringify({terms:['Trees','Alder'],sortTerms:['','Alnus'],indexGroup:'P'});paragraph.append(entry);
        const other=html.querySelector('h1:last-of-type').nextElementSibling.querySelector('p')||html.querySelector('h1:last-of-type').nextElementSibling;
        other.insertAdjacentHTML('beforeend',' Figure <span data-document-sequence="Figure">2</span>');
        for(const [owner,family,year] of [[paragraph,'Smith',2020],[other,'Brown',2021]]){
          const citation=html.createElement('span');citation.dataset.documentCitation=JSON.stringify({items:[{source:{id:`source-${family}`,type:'book',title:`Source ${family}`,author:[{family}],issued:{'date-parts':[[year]]}},locator:'12',label:'page'}],renderedStyle:'apa'});
          citation.textContent=`(${family}, ${year}, p. 12)`;owner.append(citation);
        }
        data.setData('text/html',html.body.innerHTML);
      }
      if(structuralControls){
        const html=new DOMParser().parseFromString(data.getData('text/html'),'text/html');
        if(lists){const following=html.querySelector('ol[data-continue-list]');following.removeAttribute('data-continue-list');following.setAttribute('start','7');}
        const paragraph=html.querySelector(tables?'td p':'ol > li > p');
        for(const kind of ['plain','rich','checkbox','date']){
          const field=html.createElement('span');field.dataset.formField=JSON.stringify({kind,label:`Moved ${kind}`,tag:`tag_${kind}`,lockContent:true,lockDelete:true,checked:kind==='checkbox',dateValue:kind==='date'?'2026-11-04':''});
          field.innerHTML=kind==='rich'?'<strong>RICH_FIRST</strong><br><em>RICH_LAST</em>':kind==='checkbox'?'☒':kind==='date'?'2026-11-04':'Plain value';
          paragraph.append(html.createTextNode(' '),field);
        }
        const box=html.createElement('span');box.dataset.textBox=JSON.stringify({width:100,minHeight:60,fill:'#c9d8e8'});box.innerHTML='<strong>BOX_FIRST</strong><br><em>BOX_LAST</em>';
        paragraph.append(html.createTextNode(' '),box);
        data.setData('text/html',html.body.innerHTML);
      }
      if(structuralFields){
        const html=new DOMParser().parseFromString(data.getData('text/html'),'text/html');
        html.body.insertAdjacentHTML('afterbegin','<p>Opening context.</p>');
        html.querySelectorAll('h1')[1].style.breakBefore='page';
        html.querySelector(tables?'td p':'ol > li > p').insertAdjacentHTML('beforeend',' <span data-document-field="page">1</span>');
        if(lists){const following=html.querySelector('ol[data-continue-list]');following.removeAttribute('data-continue-list');following.setAttribute('start','7');}
        data.setData('text/html',html.body.innerHTML);
      }
      if(structuralObjects){
        const html=new DOMParser().parseFromString(data.getData('text/html'),'text/html');
        if(lists){const following=html.querySelector('ol[data-continue-list]');following.removeAttribute('data-continue-list');following.setAttribute('start','7');}
        const paragraph=html.querySelector(tables?'td p':'ol > li > p');
        paragraph.insertAdjacentHTML('beforeend',' <math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math> ');
        const shape=html.createElement('span');shape.dataset.documentShape=JSON.stringify({kind:'arrow',width:80,height:40,alt:'Moved diagram',fill:'#c9d8e8'});
        const picture=html.createElement('img');picture.src=pictureSource;picture.width=48;picture.alt='Moved illustration';picture.setAttribute('data-image-crop',JSON.stringify({left:10,right:0,top:0,bottom:0}));
        paragraph.append(shape,picture,html.createTextNode(' After object.'));
        for(const kind of ['footnote','endnote']){
          const note=html.createElement('sup');note.dataset.documentNote=JSON.stringify({kind,body:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:`Moved ${kind}`,marks:[{type:'strong'}]}]},{type:'ordered_list',attrs:{order:3},content:[{type:'list_item',content:[{type:'paragraph',content:[{type:'text',text:'Nested note wording.'}]}]}]}]}});
          paragraph.append(note);
        }
        data.setData('text/html',html.body.innerHTML);
      }
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, { lists, outlineLists, listParagraphs, structuralObjects, structuralFields, structuralControls, structuralGenerated, bookmarks, pictureSource:pictureBefore?.src, tables });
    await expect(editor.locator("h1")).toHaveCount(2);
    if(lists||tables)original=await editor.textContent();
    if(bookmarks)bookmarkId=await bookmarkNodes.getAttribute('data-bookmark-id');
  }
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const commentDialog=page.getByRole('dialog',{name:'Comments',exact:true});
  const commentNodes=editor.locator('[data-comment-thread]');
  const openComments=async()=>{
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Comments…',exact:true}).click();
  };
  const checkComments=async pending=>{
    if(!comments)return;
    await expect(commentNodes).toHaveCount(pending?4:2);
    expect(new Set(await commentNodes.evaluateAll(nodes=>nodes.map(n=>n.dataset.commentThread))).size).toBe(1);
    await openComments();
    await expect(commentDialog.getByRole('listitem')).toHaveCount(1);
    await expect(commentDialog).not.toContainText('Anchor incomplete');
    await commentDialog.getByRole('button',{name:'Close',exact:true}).click();
  };
  if(comments){
    await editor.evaluate((el,section)=>{
      el.focus();const start=section?el.querySelector('h1'):el.querySelector('p');
      const end=section?el.querySelectorAll('h1')[1].previousElementSibling:start;
      const range=document.createRange();range.setStart(start,0);range.setEnd(end,end.childNodes.length);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    },section);
    await openComments();
    await commentDialog.getByLabel('Comment author',{exact:true}).fill('Reader');
    await commentDialog.getByLabel('Comment text',{exact:true}).fill('Check this moved passage.');
    await commentDialog.getByRole('button',{name:'Add comment',exact:true}).click();
    await expect(commentNodes).toHaveCount(2);
  }
  await open();
  await dialog.getByLabel("Review author", { exact: true }).fill("Reviewer");
  await dialog.getByLabel("Track changes", { exact: true }).check();
  await close();
  report.stage = "pointer move";
  if (section) {
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()
        .items.flatMap((m) => m.submenu?.items || [])
        .find((i) => i.label === "Show Outline");
      const w = BrowserWindow.getAllWindows()[0];
      Reflect.apply(item.click, item, [
        { triggeredByAccelerator: false },
        w,
        w.webContents,
      ]);
    });
    const outline = page.getByRole("complementary", {
      name: "Document outline",
      exact: true,
    });
    await outline
      .getByRole("button", { name: "Introduction", exact: true })
      .click();
    await outline.getByRole("button", { name: "Move heading down" }).click();
    await outline.getByRole("button", { name: "Close outline" }).click();
  } else {
    await page.getByRole("tab", { name: "Pages", exact: true }).click();
    const units = page.locator(block ? ".unit-paragraph" : ".unit-sentence");
    await expect(units.first().locator(".unit-outline").first()).toBeVisible();
    const rect = async (phrase) =>
      units.evaluateAll((nodes, phrase) => {
        const n = nodes.find((n) => JSON.parse(n.dataset.unit).text === phrase);
        return n
          ?.querySelector(".unit-outline")
          .getBoundingClientRect()
          .toJSON();
      }, phrase);
    const source = await rect(
        block ? "Alpha sentence. Beta sentence." + (pictures || shapes || boxes ? "\ufffc" : sequences ? ' Figure 1' : citations ? ' '+citationText : references ? 'Reference target' : fields ? fieldText : forms ? "Field value." : equations ? "Read fraction." : "") : "Alpha sentence.",
      ),
      target = await rect(
        block ? "Gamma sentence. Delta sentence."+(sequences?' Figure 2':'') : "Delta sentence.",
      );
    if (!source || !target) throw Error("Sentence outlines unavailable: " + JSON.stringify(await units.evaluateAll(nodes=>nodes.map(n=>JSON.parse(n.dataset.unit).text))));
    await page.mouse.move(source.x + 0.5, source.y + 0.5);
    await page.mouse.down();
    await page.mouse.move(
      target.x + target.width - 1,
      target.y + target.height + (block ? 2 : -target.height / 2),
      { steps: 12 },
    );
    await expect(page.locator(".unit-held")).toHaveCount(1);
    await expect(page.locator(".is-unit-gap")).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator(".unit-held")).toHaveCount(0);
    await page.getByRole("tab", { name: "Write", exact: true }).click();
  }
  await expect(editor.locator(selector)).toHaveCount(count);
  if(comments){
    await checkComments(true);
    await openComments();await commentDialog.getByRole('listitem').click();
    await commentDialog.getByLabel('Comment text',{exact:true}).fill('Confirmed after moving.');
    await commentDialog.getByRole('button',{name:'Reply',exact:true}).click();
    await commentDialog.getByRole('button',{name:'Resolve',exact:true}).click();
    await expect(commentDialog.getByRole('button',{name:'Reopen',exact:true})).toBeVisible();
    await commentDialog.getByRole('button',{name:'Close',exact:true}).click();
    expect(await commentNodes.evaluateAll(nodes=>nodes.every(n=>{const t=JSON.parse(n.dataset.commentContent);return t.resolved&&t.entries.length===2;}))).toBe(true);
    await editor.press('Control+z');await editor.press('Control+z');
    expect(await commentNodes.evaluateAll(nodes=>nodes.every(n=>{const t=JSON.parse(n.dataset.commentContent);return !t.resolved&&t.entries.length===1;}))).toBe(true);
  }
  const checkLists=async(pending,originalView=false)=>{
    if(!lists)return;
    await expect(editor.locator('ol')).toHaveCount(pending?3:2);
    await expect(editor.locator('ul')).toHaveCount(pending?2:1);
    await expect(editor.locator('ol').filter({hasText:'Other item'})).toHaveAttribute('start',String(structuralObjects||structuralFields||structuralControls||structuralGenerated?7:originalView?5:1));
    const moved=editor.locator('ol').filter({hasText:'First item'});
    for(const node of await moved.all()){
      await expect(node).toHaveAttribute('start','3');
      await expect(node.locator('strong').first()).toHaveText('First item');
      if(listParagraphs){
        await expect(node.locator(':scope > li')).toHaveCount(2);
        await expect(node.locator(':scope > li').first().locator(':scope > p')).toHaveCount(3);
        await expect(node.locator('ul > li > p')).toHaveCount(2);
        await expect(node.locator('em')).toHaveText('Second paragraph');
      }
      if(!outlineLists)expect(await node.locator('ul').evaluate(el=>getComputedStyle(el).listStyleType)).toBe('square');
    }
    if(outlineLists){
      const other=structuralObjects||structuralFields||structuralControls||structuralGenerated?'G.':originalView?'E.':'A.';
      expect(await editor.locator('[data-outline-number]').evaluateAll(nodes=>nodes.map(n=>n.textContent.trim()))).toEqual(pending?['C.','C(a)','D.',other,'C.','C(a)','D.']:originalView?['C.','C(a)','D.',other]:[other,'C.','C(a)','D.']);
    }
  };
  await checkLists(true);
  const checkTables=async pending=>{
    if(!tables)return;
    await expect(editor.locator('table')).toHaveCount(pending?4:2);
    const grids=editor.locator('table').filter({hasText:'Merged header'});
    for(const grid of await grids.all()){
      await expect(grid.locator('th')).toHaveAttribute('colspan','2');
      await expect(grid.locator('th')).toHaveCSS('background-color','rgb(221, 238, 255)');
      await expect(grid.locator('ol')).toHaveAttribute('start','3');
      await expect(grid.locator('strong').first()).toHaveText('List cell');
    }
    expect(await editor.locator('[data-caption-target]').evaluateAll(nodes=>nodes.every(caption=>caption.previousElementSibling?.querySelector('table')?.dataset.objectId===caption.dataset.captionTarget))).toBe(true);
  };
  await checkTables(true);
  const checkStructuralControls=async pending=>{
    if(!structuralControls)return;
    await expect(controls).toHaveCount(pending?8:4);
    await expect(textBoxes).toHaveCount(pending?2:1);
    expect(new Set(await controls.evaluateAll(nodes=>nodes.map(n=>n.dataset.fieldId))).size).toBe(pending?8:4);
    for(const node of await textBoxes.all()){
      await expect(node.locator('strong')).toHaveText('BOX_FIRST');
      await expect(node.locator('em')).toHaveText('BOX_LAST');
      expect(JSON.parse(await node.getAttribute('data-text-box')).fill).toBe('#c9d8e8');
    }
    expect(await controls.evaluateAll(nodes=>nodes.every(n=>{const a=JSON.parse(n.dataset.formField);return a.lockContent&&a.lockDelete&&a.label===`Moved ${a.kind}`;}))).toBe(true);
  };
  await checkStructuralControls(true);
  const checkStructuralGenerated=async pending=>{
    if(!structuralGenerated)return;
    await expect(citationNodes).toHaveCount(pending?3:2);
    await expect(indexNodes).toHaveCount(pending?2:1);
    await expect(referenceNodes).toHaveCount(pending?2:1);
    await expect(referenceNodes).toHaveText(pending?['Conclusion','Conclusion']:['Conclusion']);
    await referenceNodes.last().click({modifiers:['Control']});
    await expect.poll(()=>editor.evaluate(el=>{
      const anchor=getSelection().anchorNode;const heading=(anchor?.nodeType===1?anchor:anchor?.parentElement)?.closest('h1');
      return !!heading&&el.contains(heading)&&heading.textContent==='Conclusion';
    })).toBe(true);
  };
  await checkStructuralGenerated(true);
  const checkStructuralObjects=async pending=>{
    if(!structuralObjects)return;
    await expect(editor.locator('[data-equation]')).toHaveCount(pending?2:1);
    await expect(editor.locator('[data-document-shape]')).toHaveCount(pending?2:1);
    await expect(images).toHaveCount(pending?2:1);
    expect(await images.evaluateAll(nodes=>nodes.every(n=>n.alt==='Moved illustration'))).toBe(true);
    await expect(noteRefs).toHaveCount(pending?4:2);
    expect(await noteRefs.evaluateAll(nodes=>nodes.map(n=>n.dataset.noteNumber))).toEqual(pending?['1','i','1','i']:['1','i']);
    for(const kind of ['footnote','endnote'])await expect(page.locator('.book-main .page-sheet [data-note-fragment]').filter({hasText:`Moved ${kind}`})).toHaveCount(1);
    expect(await editor.locator('[data-document-shape]').evaluateAll(nodes=>nodes.every(n=>{const a=JSON.parse(n.dataset.documentShape);return a.kind==='arrow'&&a.width===80&&a.alt==='Moved diagram';}))).toBe(true);
  };
  await checkStructuralObjects(true);
  if(structuralObjects){
    await noteRefs.first().dblclick();
    const properties=page.getByRole('dialog',{name:'Notes',exact:true});
    await expect(properties.getByRole('textbox',{name:'Note text',exact:true})).toContainText('Moved footnote');
    await properties.getByRole('button',{name:'Close notes',exact:true}).click();
  }
  const checkCaptionAnchors=async(expected)=>{
    await expect(editor.locator('[data-caption-target]')).toHaveCount(expected);
    expect(await editor.locator('[data-caption-target]').evaluateAll(nodes=>nodes.every(node=>node.previousElementSibling?.querySelector('img')?.dataset.objectId===node.dataset.captionTarget))).toBe(true);
  };
  if(captions)await checkCaptionAnchors(2);
  if(bookmarks){
    await expect(bookmarkNodes).toHaveCount(2);
    const properties=await openBookmarks();
    await expect(properties.getByRole('listitem')).toHaveCount(1);
    await properties.getByRole('button',{name:'Go to Passage',exact:true}).click();
    await expect.poll(()=>editor.evaluate(el=>[...el.querySelectorAll('[data-revision-block-move]')].some(node=>JSON.parse(node.dataset.revisionBlockMove).kind==='insertion'&&node.contains(getSelection().anchorNode)))).toBe(true);
  }
  if(sequences||structuralGenerated){
    await expect(sequenceNodes).toHaveText(['1','2','1']);
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Update fields',exact:true}).click();
    await expect(sequenceNodes).toHaveText(['2','1','2']);
    original=original.replace(/Figure [12]/g,value=>value==='Figure 1'?'Figure 2':'Figure 1');
  }
  if(citations){
    await expect(citationNodes).toHaveCount(2);
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Update fields',exact:true}).click();
    await expect(citationNodes).toHaveText([citationText,citationText]);
  }
  if(indexes){
    await expect(indexNodes).toHaveCount(2);
    expect(new Set(await indexNodes.evaluateAll(nodes=>nodes.map(el=>el.dataset.indexId))).size).toBe(2);
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Index entries…',exact:true}).click();
    const properties=page.getByRole('dialog',{name:'Index entries',exact:true});
    await expect(properties.getByLabel('Index entry',{exact:true}).locator('option')).toHaveCount(2);
    await properties.getByLabel('Index entry',{exact:true}).selectOption(indexBefore);
    await expect(properties.getByLabel('Index group',{exact:true})).toHaveValue('P');
    await properties.locator('summary').filter({hasText:/^Sorting$/}).click();
    await expect(properties.getByLabel('Sort main entry as',{exact:true})).toHaveValue('Woodland');
    await properties.getByRole('button',{name:'Close index entries',exact:true}).click();
  }
  if(references){
    await expect(referenceNodes).toHaveCount(2);
    expect(await referenceNodes.evaluateAll(nodes=>nodes.map(el=>el.dataset.crossReference))).toEqual([referenceTarget,referenceTarget]);
    await referenceNodes.last().click({modifiers:['Control']});
    await expect.poll(()=>editor.evaluate(el=>el.querySelector('h1').contains(getSelection().anchorNode))).toBe(true);
  }
  if(fields||structuralFields){
    await expect(fieldNodes).toHaveCount(2);
    await page.locator('.book-main .format-toolbar').getByRole('button',{name:'More formatting',exact:true}).click();
    await page.getByRole('menuitem',{name:'Update fields',exact:true}).click();
    await expect(fieldNodes).toHaveText(['1','2']);
  }
  if(notes){
    await expect(noteRefs).toHaveCount(2);
    expect(new Set(await noteRefs.evaluateAll(nodes=>nodes.map(el=>el.dataset.noteId))).size).toBe(2);
    await expect(page.locator('.book-main .page-sheet [data-note-fragment]').filter({hasText:'Moved note wording.'})).toHaveCount(1);
    await noteRefs.first().dblclick();
    const properties=page.getByRole('dialog',{name:'Notes',exact:true});
    await expect(properties.getByRole('textbox',{name:'Note text',exact:true})).toHaveText('Moved note wording.');
    await properties.getByRole('button',{name:'Close notes',exact:true}).click();
  }
  if(pictures){
    await expect(images).toHaveCount(2);
    const ids=await images.evaluateAll(nodes=>nodes.map(el=>el.dataset.objectId));
    expect(new Set(ids).size).toBe(2);expect(ids).toContain(pictureBefore.id);
  }
  if(boxes){await expect(textBoxes).toHaveCount(2);expect(new Set(await textBoxes.evaluateAll(nodes=>nodes.map(el=>el.dataset.objectId))).size).toBe(2);}
  if(forms){await expect(controls).toHaveCount(2);expect(new Set(await controls.evaluateAll(nodes=>nodes.map(el=>el.dataset.fieldId))).size).toBe(2);}
  if(shapes){await expect(diagrams).toHaveCount(2);expect(new Set(await diagrams.evaluateAll(nodes=>nodes.map(el=>el.dataset.shapeId))).size).toBe(2);}
  if(equations){await expect(formulas).toHaveCount(2);expect(new Set(await formulas.evaluateAll(nodes=>nodes.map(el=>el.dataset.equationId))).size).toBe(2);}
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await open();
  await expect(dialog.locator(".review-list button")).toHaveCount(1);
  await expect(dialog.locator(".review-list")).toContainText("Moved from");
  await expect(dialog.locator(".review-list")).toContainText("Moved to");
  await dialog
    .getByLabel("Review preview", { exact: true })
    .selectOption("original");
  await expect(
    dialog.getByLabel("original document preview", { exact: true }),
  ).toHaveText(original);
  await dialog
    .getByLabel("Review preview", { exact: true })
    .selectOption("final");
  const final = await dialog
    .getByLabel("final document preview", { exact: true })
    .textContent();
  expect(final).not.toBe(original);
  await page.screenshot({ path: path.join(directory, "review.png") });
  await close();
  report.stage = "undo and reload";
  if(sequences||structuralGenerated){await editor.press('Control+z');await expect(sequenceNodes).toHaveText(['1','2','1']);}
  if(fields||structuralFields){
    await editor.press('Control+z');
    await expect(editor.locator(selector)).toHaveCount(count);
    await expect(fieldNodes).toHaveText(['1','1']);
  }
  await editor.press("Control+z");
  await expect(editor.locator(selector)).toHaveCount(0);
  await editor.press("Control+y");
  await expect(editor.locator(selector)).toHaveCount(count);
  if(fields||structuralFields){await editor.press('Control+y');await expect(fieldNodes).toHaveText(['1','2']);}
  if(sequences||structuralGenerated){await editor.press('Control+y');await expect(sequenceNodes).toHaveText(['2','1','2']);}
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Tracked moves" })
    .click();
  await expect(editor.locator(selector)).toHaveCount(count);
  for (const scale of ["0.5", "1.5", "1"]) {
    await page.keyboard.press("Control+,");
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await settings
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await settings.getByLabel("UI Scale", { exact: true }).selectOption(scale);
    await settings
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
    await open();
    expect(
      await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.left >= 0 &&
          r.top >= 0 &&
          r.right <= innerWidth + 1 &&
          r.bottom <= innerHeight + 1
        );
      }),
    ).toBe(true);
    await close();
  }
  report.stage = "decisions";
  if(comments||structuralObjects||structuralFields||structuralControls||structuralGenerated){
    await expect(page.locator('.save-status')).toHaveText('Saved');
    const exported=await page.evaluate(async()=>{
      const projects=await window.alder.request('GET','/api/projects');
      const source=await window.alder.request('GET',`/api/projects/${projects.projects[0].id}`);
      const result=await window.alder.request('POST',`/api/projects/${source.id}/export`,{format:'docx'});
      const response=await fetch(window.alder.mediaBase+result.downloadUrl);
      return {source,result,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};
    });
    const file=path.join(directory,'alder.docx');fs.writeFileSync(file,Buffer.from(exported.bytes));
    fs.writeFileSync(path.join(directory,'fixture-project.json'),JSON.stringify(exported.source));
    fs.writeFileSync(path.join(directory,'fixture-exports.json'),JSON.stringify({docx:{...exported.result,path:file},movesExpected:1,skipListNumbers:true,unlockMovedControlsForReview:structuralControls||structuralGenerated,expectedText:[comments?section?'Conclusion':'Gamma sentence. Delta sentence.':structuralFields||structuralControls||structuralGenerated?'Conclusion':'After object.']}));
  }
  await open();
  await dialog.getByRole("button", { name: "Reject", exact: true }).click();
  await close();
  await expect(editor).toHaveText(original);
  await checkComments(false);
  await checkLists(false,true);
  await checkTables(false);
  await checkStructuralObjects(false);
  await checkStructuralControls(false);
  await checkStructuralGenerated(false);
  if(captions)await checkCaptionAnchors(1);
  if(bookmarks){await expect(bookmarkNodes).toHaveCount(1);await expect(bookmarkNodes).toHaveAttribute('data-bookmark-id',bookmarkId);}
  if(sequences||structuralGenerated)await expect(sequenceNodes).toHaveText(['2','1']);
  if(citations){await expect(citationNodes).toHaveCount(1);expect(JSON.parse(await citationNodes.getAttribute('data-document-citation'))).toEqual(citationBefore);}
  if(indexes){await expect(indexNodes).toHaveCount(1);await expect(indexNodes).toHaveAttribute('data-index-id',indexBefore);}
  if(references){await expect(referenceNodes).toHaveCount(1);await expect(referenceNodes).toHaveAttribute('data-cross-reference',referenceTarget);}
  if(fields||structuralFields){await expect(fieldNodes).toHaveCount(1);await expect(fieldNodes).toHaveText('1');}
  if(notes){await expect(noteRefs).toHaveCount(1);expect(JSON.parse(await noteRefs.first().getAttribute('data-document-note'))).toEqual(noteBefore);}
  if(pictures){await expect(images).toHaveCount(1);expect(await images.first().getAttribute('data-object-id')).toBe(pictureBefore.id);}
  if(boxes){await expect(textBoxes).toHaveCount(1);expect(JSON.parse(await textBoxes.first().getAttribute("data-text-box"))).toEqual(boxBefore);await expect(textBoxes).toHaveText("Box value.");}
  if(forms){await expect(controls).toHaveCount(1);expect(JSON.parse(await controls.first().getAttribute("data-form-field"))).toEqual(formBefore);await expect(controls).toHaveText("Field value.");}
  if(shapes){await expect(diagrams).toHaveCount(1);expect(JSON.parse(await diagrams.first().getAttribute('data-document-shape'))).toEqual(shapeBefore);}
  if(equations){await expect(formulas).toHaveCount(1);expect(JSON.parse(await formulas.first().getAttribute('data-equation'))).toEqual(equationBefore);}
  await editor.press("Control+z");
  await expect(editor.locator(selector)).toHaveCount(count);
  await open();
  await dialog.getByRole("button", { name: "Accept", exact: true }).click();
  await close();
  await expect(editor).toHaveText(final);
  await checkComments(false);
  await checkLists(false);
  await checkTables(false);
  await checkStructuralObjects(false);
  await checkStructuralControls(false);
  await checkStructuralGenerated(false);
  if(captions)await checkCaptionAnchors(1);
  if(bookmarks){await expect(bookmarkNodes).toHaveCount(1);await expect(bookmarkNodes).toHaveAttribute('data-bookmark-id',bookmarkId);}
  if(sequences||structuralGenerated)await expect(sequenceNodes).toHaveText(['1','2']);
  if(citations){await expect(citationNodes).toHaveCount(1);expect(JSON.parse(await citationNodes.getAttribute('data-document-citation'))).toEqual(citationBefore);}
  if(indexes){await expect(indexNodes).toHaveCount(1);await expect(indexNodes).toHaveAttribute('data-index-id',indexBefore);}
  if(references){
    await expect(referenceNodes).toHaveCount(1);await expect(referenceNodes).toHaveAttribute('data-cross-reference',referenceTarget);
    await referenceNodes.click({modifiers:['Control']});
    await expect.poll(()=>editor.evaluate(el=>el.querySelector('h1').contains(getSelection().anchorNode))).toBe(true);
  }
  if(fields||structuralFields){await expect(fieldNodes).toHaveCount(1);await expect(fieldNodes).toHaveText('2');}
  if(notes){await expect(noteRefs).toHaveCount(1);expect(JSON.parse(await noteRefs.first().getAttribute('data-document-note'))).toEqual(noteBefore);}
  await expect(editor.locator(selector)).toHaveCount(0);
  if(pictures){await expect(images).toHaveCount(1);expect(await images.first().getAttribute('data-object-id')).toBe(pictureBefore.id);}
  if(boxes){await expect(textBoxes).toHaveCount(1);expect(JSON.parse(await textBoxes.first().getAttribute("data-text-box"))).toEqual(boxBefore);await expect(textBoxes).toHaveText("Box value.");}
  if(forms){await expect(controls).toHaveCount(1);expect(JSON.parse(await controls.first().getAttribute("data-form-field"))).toEqual(formBefore);await expect(controls).toHaveText("Field value.");}
  if(shapes){await expect(diagrams).toHaveCount(1);expect(JSON.parse(await diagrams.first().getAttribute('data-document-shape'))).toEqual(shapeBefore);}
  if(equations){await expect(formulas).toHaveCount(1);expect(JSON.parse(await formulas.first().getAttribute('data-equation'))).toEqual(equationBefore);}
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack || error);
  process.exitCode = 1;
  await page
    ?.screenshot({ path: path.join(directory, "failure.png") })
    .catch(() => {});
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  if(report.status === "failed") await app?.evaluate(({app})=>app.exit(1)).catch(()=>{});
  await app?.close().catch(() => {});
}
