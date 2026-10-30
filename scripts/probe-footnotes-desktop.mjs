import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { desktopExecutable } from "./desktop-paths.mjs";
const directory = path.resolve("work/footnotes-prototype"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-notes-"));
fs.mkdirSync(directory, { recursive: true });
await build({
  entryPoints: ["scripts/footnote-prototype.ts"],
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
    w.setSize(1200, 900);
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
  for (let i = 0; i < 36; i++) {
    if (i) content.push({ type: "hard_break" });
    content.push({
      type: "text",
      text: `BODY${String(i).padStart(3, "0")} Body line.`,
    });
    if ([8, 10, 35].includes(i))
      content.push({
        type: "probe_note",
        attrs: { name: `NOTE${i}`, blockId: `note_${i}` },
      });
  }
  const doc = { type: "doc", content: [{ type: "paragraph", content }] };
  await page.evaluate(
    (doc) =>
      window.__notesProbe.load(doc, { NOTE8: 12, NOTE10: 22, NOTE35: 28 }),
    doc,
  );
  const original = await page.evaluate(() => window.__notesProbe.result());
  report.result = original;
  for (const anchor of original.anchors) {
    const actual = original.notes.fragments.findIndex((pieces) =>
      pieces?.some((piece) => piece.id === anchor.id && !piece.continued),
    );
    expect(actual).toBe(anchor.page);
  }
  expect(original.pages.length).toBeGreaterThan(4);
  expect(original.pages.every((page,index)=>page.to>page.from||original.notes.fragments[index]?.length)).toBe(true);
  const captured = await page.evaluate(() => window.__notesProbe.capture());
  fs.writeFileSync(path.join(directory, "publication.html"), captured);
  for (const scale of [0.5, 1, 1.5]) {
    await page.evaluate((scale) => window.__notesProbe.scale(scale), scale);
    expect(
      (await page.evaluate(() => window.__notesProbe.result())).pages.map(
        (p) => [p.from, p.to],
      ),
    ).toEqual(original.pages.map((p) => [p.from, p.to]));
  }
  await page.evaluate(() => window.__notesProbe.scale(1));
  await page.screenshot({ path: path.join(directory, "editor.png") });
  const pdf = await app.evaluate(async ({ BrowserWindow }, html) => {
    const w = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true },
    });
    try {
      await w.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html),
      );
      await w.webContents.executeJavaScript("document.fonts.ready");
      return [
        ...(await w.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        })),
      ];
    } finally {
      w.destroy();
    }
  }, captured);
  fs.writeFileSync(path.join(directory, "notes.pdf"), Buffer.from(pdf));
  const editor = page.getByRole("textbox", {
    name: "Footnote body",
    exact: true,
  });
  await page.evaluate(() => window.__notesProbe.select(1));
  await editor.press("X");
  await expect(editor).toContainText("XBODY000");
  await editor.press("Control+z");
  await expect(editor).not.toContainText("XBODY000");
  await page.evaluate(()=>window.__notesProbe.columns(2));
  const columns=await page.evaluate(()=>window.__notesProbe.result());report.columns=columns;
  for(const anchor of columns.anchors)expect(columns.notes.fragments.findIndex(pieces=>pieces?.some(piece=>piece.id===anchor.id&&!piece.continued))).toBe(anchor.page);
  expect(columns.pages.every((page,index)=>page.to>page.from||columns.notes.fragments[index]?.length)).toBe(true);
  // Exercise the product schema, note measurement and audio-clock highlight.
  const rich={type:'doc',content:[{type:'paragraph',attrs:{align:'justify'},content:[{type:'text',text:'Unicode 😀 '},{type:'text',text:'highlight',marks:[{type:'strong'}]},{type:'text',text:' words.\tAligned words.'},{type:'hard_break'},{type:'hard_break'},{type:'text',text:'After blank line.',marks:[{type:'em'}]}]},{type:'paragraph',content:[{type:'text',text:'Final paragraph.'}]}]};
  const real={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Body reference.'},{type:'document_note',attrs:{blockId:'real-note',kind:'footnote',body:rich}}]}]};
  report.real=await page.evaluate(doc=>window.__notesProbe.real(doc),real);
  const spoken=await page.evaluate(()=>window.__notesProbe.narration());
  expect(spoken.text).toContain('Unicode 😀 highlight');
  const highlighted=await page.evaluate(()=>window.__notesProbe.highlight({id:'real-note',start:11,end:20}));
  expect(highlighted.text).toBe('highlight');
  expect(highlighted.rects.length).toBeGreaterThan(0);
  expect(Math.abs(highlighted.ink.top-highlighted.rects[0].top)).toBeLessThan(1);
  const beforeBlank=await page.evaluate(()=>window.__notesProbe.highlight({id:'real-note',start:0,end:7}));
  const afterBlank=await page.evaluate(()=>window.__notesProbe.highlight({id:'real-note',start:44,end:49}));
  report.highlight={highlighted,beforeBlank,afterBlank};
  const scaleRows=[];
  for(const scale of [.5,1,1.5]){
    await page.evaluate(scale=>window.__notesProbe.scale(scale),scale);
    const lines=await page.evaluate(rich=>window.__notesProbe.measureText(rich),rich);
    scaleRows.push(lines.map(line=>line.height));
  }
  expect(scaleRows[0]).toEqual(scaleRows[1]);expect(scaleRows[1]).toEqual(scaleRows[2]);
  const many={type:'doc',content:Array.from({length:100},(_,i)=>({
    type:'paragraph',content:[
      {type:'text',text:'Performance body '+i+'. A paragraph of prose with a short scholarly note.'},
      {type:'document_note',attrs:{blockId:'performance_'+i,kind:'footnote',body:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'A source for paragraph '+i+'.'}]}]}}},
    ],
  }))};
  report.performance=await page.evaluate(doc=>window.__notesProbe.real(doc),many);
  report.performance.editMilliseconds=await page.evaluate(()=>window.__notesProbe.append(' An edit after the final note.'));
  report.performance.warmEdits=[];
  for(let i=0;i<3;i++)report.performance.warmEdits.push(await page.evaluate(()=>window.__notesProbe.append(' More.')));
  expect(report.errors).toEqual([]);
  report.status = "passed";
  report.cases.push(
    "Long notes, crowded anchors, carry-over after body end, scale-independent layout, native edit/undo and PDF",
  );
} catch (error) {
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
