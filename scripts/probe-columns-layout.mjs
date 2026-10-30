import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/columns-prototype"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-mirror-"));
fs.mkdirSync(directory, { recursive: true });
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "probe.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
let app, page;
const report = { status: "running", errors: [], cases: [] };
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => report.errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    fs.readFileSync(path.join(directory, "probe.js"), "utf8"),
  );
  const content = [];
  for (let i = 0; i < 50; i++) {
    if (i) content.push({ type: "hard_break" });
    content.push({
      type: "text",
      text: `COLUMN${String(i).padStart(3, "0")} Small line.`,
    });
  }
  await page.evaluate((content) => {
    window.__layoutProbe.pageSize({
      width: 600,
      height: 420,
      margin: 40,
      columns: { count: 2, gapMm: 8 },
    });
    window.__layoutProbe.document({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            paragraphBackground: "#eef3ff",
            paragraphBorderColor: "#23405e",
            paragraphBorderWidth: 1,
          },
          content,
        },
      ],
    });
  }, content);
  await expect
    .poll(() =>
      page.evaluate(() => {
        try {
          return window.__layoutProbe.pages().length;
        } catch {
          return 0;
        }
      }),
    )
    .toBeGreaterThan(1);
  const editor = page.getByRole("textbox", {
    name: "Text editor",
    exact: true,
  });

  report.pages = await page.evaluate(() => window.__layoutProbe.pages());
  report.coordinates = await editor.evaluate((el) => {
    const origin = el.closest(".flow-canvas").getBoundingClientRect();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const points = [];
    while (walker.nextNode()) {
      const t = walker.currentNode;
      for (const m of t.textContent.matchAll(/COLUMN\d+/g)) {
        const r = document.createRange();
        r.setStart(t, m.index);
        r.setEnd(t, m.index + m[0].length);
        const b = r.getBoundingClientRect();
        points.push({ word: m[0], x: b.x - origin.x, y: b.y - origin.y });
      }
    }
    return points;
  });
  await page.screenshot({ path: path.join(directory, "columns.png") });
  const point = await editor.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode,
        at = t.textContent.indexOf("COLUMN018");
      if (at >= 0) {
        const r = document.createRange();
        r.setStart(t, at + 3);
        r.setEnd(t, at + 3);
        const b = r.getBoundingClientRect();
        return { x: b.x, y: (b.top + b.bottom) / 2 };
      }
    }
  });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.type("Q");
  expect(await page.evaluate(() => window.__layoutProbe.text())).toContain(
    "COLQUMN018",
  );
  await page.keyboard.press("Control+z");
  await expect
    .poll(() =>
      page.evaluate(() => {
        try {
          window.__layoutProbe.capture();
          return true;
        } catch {
          return false;
        }
      }),
    )
    .toBe(true);
  const captured = await page.evaluate(() => window.__layoutProbe.capture());
  fs.writeFileSync(path.join(directory, "columns.html"), captured.html);

  const data = await app.evaluate(async ({ BrowserWindow }, html) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    try {
      await win.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html),
      );
      await win.webContents.executeJavaScript("document.fonts.ready");
      return (
        await win.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
        })
      ).toString("base64");
    } finally {
      win.destroy();
    }
  }, captured.html);
  fs.writeFileSync(
    path.join(directory, "columns.pdf"),
    Buffer.from(data, "base64"),
  );

  const print=async(name)=>{
    await expect.poll(()=>page.evaluate(()=>{try{window.__layoutProbe.capture();return true;}catch{return false;}})).toBe(true);
    const html=(await page.evaluate(()=>window.__layoutProbe.capture())).html;
    const htmlPath=path.join(directory,name+'.html');fs.writeFileSync(htmlPath,html);
    const data=await app.evaluate(async({BrowserWindow},htmlPath)=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});try{await win.loadFile(htmlPath);await win.webContents.executeJavaScript('document.fonts.ready');return(await win.webContents.printToPDF({printBackground:true,preferCSSPageSize:true})).toString('base64');}finally{win.destroy();}},htmlPath);
    fs.writeFileSync(path.join(directory,name+'.pdf'),Buffer.from(data,'base64'));
  };
  await page.evaluate(()=>{
    const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]});
    window.__layoutProbe.document({type:'doc',content:[{type:'table',content:Array.from({length:30},(_,row)=>({type:'table_row',content:[0,1].map(col=>({type:row===0?'table_header':'table_cell',attrs:{colwidth:[120],background:col?'#f4f4f4':null},content:[paragraph(row===0?'HEAD'+col:'CELL'+row+'_'+col)]}))}))}]});
  });
  await print('columns-table');
  report.tablePages=await page.evaluate(()=>window.__layoutProbe.pages());
  await page.evaluate(()=>{
    const p=text=>({type:'paragraph',content:[{type:'text',text}]});
    window.__layoutProbe.document({type:'doc',content:[{type:'table',content:[{type:'table_row',content:[0,1].map(col=>({type:'table_header',attrs:{colwidth:[110]},content:[p('HEADER'+col)]}))},{type:'table_row',attrs:{allowSplit:true},content:[80,6].map((count,col)=>({type:'table_cell',attrs:{colwidth:[110],background:'#eef3ff'},content:[{type:'paragraph',content:Array.from({length:count},(_,i)=>[{type:'text',text:'CELL'+col+'x'+String(i).padStart(3,'0')},{type:'hard_break'}]).flat().slice(0,-1)}]}))}]}]});
  });
  await print('columns-split-table');
  report.splitPages=await page.evaluate(()=>window.__layoutProbe.pages());
  expect(report.splitPages.length).toBeGreaterThan(1);
  await page.evaluate(()=>{
    const p=text=>({type:'paragraph',content:[{type:'text',text}]});
    window.__layoutProbe.document({type:'doc',content:[p('LEFT_COLUMN'),{type:'column_break'},p('RIGHT_COLUMN'),{type:'page_break'},p('NEXT_PAGE'),{type:'section_break',attrs:{kind:'nextPage',page:{pageSize:'Custom',pageWidthMm:158.75,pageHeightMm:111.125,marginMm:10.583333333,columns:{count:3,gapMm:4}}}},p('THREE_FIRST'),{type:'column_break'},p('THREE_SECOND')]});
  });
  await print('columns-sections');
  const copied=await page.evaluate(()=>window.__layoutProbe.clipboardRoundTrip(window.__layoutProbe.doc()));
  expect(copied.filter(n=>n.type==='column_break').length).toBe(2);
  report.sectionPages=await page.evaluate(()=>window.__layoutProbe.pages());
  expect(report.sectionPages.length).toBe(3);
  expect(report.sectionPages[0].text).toContain('RIGHT_COLUMN');
  expect(report.sectionPages[1].text).toContain('NEXT_PAGE');
  expect(report.sectionPages[2].text).toContain('THREE_SECOND');

  const continuous=JSON.parse(fs.readFileSync('work/columns-continuous-word/fixture-project.json','utf8'));
  await page.evaluate(project=>{
    window.__layoutProbe.pageSize({width:148*96/25.4,height:210*96/25.4,margin:15*96/25.4,columns:project.settings.columns});
    window.__layoutProbe.document(project.book.chapters[0].document);
  },continuous);
  await print('columns-continuous');
  report.continuousPages=await page.evaluate(()=>window.__layoutProbe.pages());
  expect(report.continuousPages.length).toBe(1);
  const settled=async()=>{await expect.poll(()=>page.evaluate(()=>{try{return window.__layoutProbe.pages().length;}catch{return 0;}})).toBeGreaterThan(0);};
  const geometry=()=>page.evaluate(()=>{
    const api=window.__layoutProbe,canvas=document.querySelector('.flow-canvas'),origin=canvas.getBoundingClientRect(),scale=origin.width/parseFloat(canvas.style.width);
    const root=document.querySelector('[contenteditable=true][data-column-layout]'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),points=[];
    while(walker.nextNode()){const node=walker.currentNode;for(const m of node.textContent.matchAll(/BAND\d{3}/g)){const r=document.createRange();r.setStart(node,m.index);r.setEnd(node,m.index+m[0].length);const box=r.getBoundingClientRect();points.push({word:m[0],x:(box.x-origin.x)/scale,y:(box.y-origin.y)/scale,bottom:(box.bottom-origin.y)/scale});}}
    return {pages:api.pages(),points};
  });
  for(const long of [false,true]){
    await page.evaluate(long=>{
      let counter=0;
      const paragraph=count=>({type:'paragraph',attrs:{lineSpacingMode:'exact',lineSpacing:15,spaceBefore:0,spaceAfter:0},content:Array.from({length:count},()=>[{type:'text',text:'BAND'+String(counter++).padStart(3,'0')+' example.'},{type:'hard_break'}]).flat().slice(0,-1)});
      const boundary=count=>({type:'section_break',attrs:{kind:'continuous',page:{pageSize:'A5',marginMm:15,columns:{count,gapMm:8,separator:true}}}});
      window.__layoutProbe.document({type:'doc',content:[paragraph(long?149:15),boundary(1),paragraph(5),boundary(3),paragraph(19),boundary(2),paragraph(60)]});
    },long);
    await settled();
    const before=await geometry();
    for(const point of before.points){const owner=before.pages.find(p=>p.text.includes(point.word));expect(owner,point.word).toBeTruthy();expect(point.y,point.word).toBeGreaterThanOrEqual(owner.frame.top+(owner.frame.layout.margins?.top??owner.frame.layout.margin)-2);expect(point.bottom,point.word).toBeLessThanOrEqual(owner.frame.top+owner.frame.layout.height-(owner.frame.layout.margins?.bottom??owner.frame.layout.margin)+2);}
    await print(long?'columns-long-continuous':'columns-bands');
    await page.evaluate(()=>window.__layoutProbe.fullLayout());await settled();
    expect(await geometry()).toEqual(before);
    await page.evaluate(()=>{const api=window.__layoutProbe;api.edit(api.text().indexOf('BAND')+2,api.text().indexOf('BAND')+2,'new ');});await settled();
    const edited=await geometry();
    await page.evaluate(()=>window.__layoutProbe.fullLayout());await settled();
    expect(await geometry()).toEqual(edited);
    report.cases.push({long,pages:before.pages.length,markers:before.points.length});
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  await page
    ?.screenshot({ path: path.join(directory, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
