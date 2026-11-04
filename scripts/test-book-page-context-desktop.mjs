import { _electron as electron, expect } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = path.resolve("work/book-page-context-ui");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-book-context-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", errors: [] };
let app, page;
try {
  app = await electron.launch({ executablePath: desktopExecutable(), args: [".", "--headless-test", `--user-data-dir=${profile}/profile`], env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` } });
  app.on("window", window => window.on("pageerror", e => report.errors.push(e.message)));
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const p = await window.alder.request("POST", "/api/projects", { name: "Book page context", template: "blank" });
    const paragraph = text => ({ type: "paragraph", content: [{ type: "text", text }] });
    const chapter = (id, content, include = true) => ({ id, title: id, include, document: { type: "doc", content } });
    Object.assign(p.settings, { documentKind: "book", pageSize: "A5", marginMm: 16, includeTitle: true, includeToc: false, chapterPageBreaks: false, footer: true });
    const first = paragraph("CHAPTER_A_BODY 😀");
    first.content.push({ type: "document_note", attrs: { blockId: "note_a", kind: "endnote", body: { type: "doc", content: Array.from({ length: 70 }, (_, i) => paragraph(`NOTE_${String(i).padStart(3, "0")} ${"Measured endnote wording. ".repeat(8)}`)) } } });
    p.book = { version: 1, chapters: [
      chapter("First", [first]),
      chapter("Excluded", [paragraph("EXCLUDED_BODY")], false),
      chapter("Second", [paragraph("CHAPTER_B_BODY"), { type: "section_break", attrs: { kind: "nextPage", numberingStart: 7, numberingFormat: "upperRoman", page: { pageSize: "A4", marginMm: 20 } } }, paragraph("CHAPTER_B_SECTION")]),
      chapter("Third", [paragraph("CHAPTER_C_BODY")]),
    ] };
    await window.alder.request("PUT", `/api/projects/${p.id}`, { project: p, expectedRevision: p.revision });
  });
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator(".project-list-item").filter({ hasText: "Book page context" }).click();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(1440, 1000); w.show(); w.focus(); });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const contents = page.getByRole("combobox", { name: "PDF preview contents", exact: true });
  await expect(contents).toBeVisible({ timeout: 90000 });
  await expect(contents.locator("option")).toHaveCount(4);
  const exports = path.join(profile, "data", "exports");
  const results = fs.readdirSync(exports).map(name => path.join(exports, name, "result.json")).filter(file => fs.existsSync(file)).map(file => JSON.parse(fs.readFileSync(file, "utf8")));
  const proof = results.find(result => result.chapterPages?.length === 3);
  expect(proof).toBeTruthy();
  const [first, second, third] = proof.chapterPages;
  expect(first).toMatchObject({ id: "First", bodyPage: 0, bodyPageLabel: "1", startsOnSharedPage: true });
  expect(second.bodyPage).toBe(0);
  expect(third).toMatchObject({ bodyPage: 1, bodyPageLabel: "VII", startsOnSharedPage: true });
  expect(first.pageIndexes.at(-1)).toBeGreaterThan(third.bodyPage);
  const loading = getDocument({ data: new Uint8Array(fs.readFileSync(proof.path)), disableFontFace: true });
  const pdf = await loading.promise;
  const texts = [];
  for (let i = 1; i <= pdf.numPages; i++) texts.push((await (await pdf.getPage(i)).getTextContent()).items.map(item => item.str || "").join(" "));
  for (const [chapter, marker] of [[first, "CHAPTER_A_BODY"], [second, "CHAPTER_B_BODY"], [third, "CHAPTER_C_BODY"]]) expect(texts[chapter.bodyPage]).toContain(marker);
  const all = texts.join(" ");
  expect(all).not.toContain("EXCLUDED_BODY");
  for (let i = 0; i < 70; i++) {
    const marker = `NOTE_${String(i).padStart(3, "0")}`;
    expect(all.split(marker)).toHaveLength(2);
    expect(first.pageIndexes).toContain(texts.findIndex(text => text.includes(marker)));
  }
  await contents.selectOption("Third");
  await expect(page.getByLabel("PDF page number", { exact: true })).toHaveValue("2");
  await contents.selectOption("Second");
  await expect(page.getByLabel("PDF page number", { exact: true })).toHaveValue("1");
  for (const scale of ["0.5", "1.5", "1"]) {
    await page.keyboard.press("Control+,");
    const settings = page.getByRole("dialog", {name:"Settings",exact:true});
    await settings.getByRole("tab", {name:"Appearance",exact:true}).click();
    await settings.getByLabel("UI Scale", {exact:true}).selectOption(scale);
    await settings.getByRole("button", {name:"Close settings",exact:true}).click();
    await contents.selectOption("Third");
    await expect(page.getByLabel("PDF page number", {exact:true})).toHaveValue("2");
    expect(await contents.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;})).toBe(true);
  }
  await page.screenshot({ path: path.join(directory, "preview.png") });
  fs.copyFileSync(proof.path, path.join(directory, "book.pdf"));
  report.chapters = proof.chapterPages;
  report.pages = pdf.numPages;
  await loading.destroy();
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.error = String(error.stack || error); process.exitCode = 1;
  await page?.screenshot({ path: path.join(directory, "failure.png") }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  if (report.status === "failed") await app?.evaluate(({ app }) => app.exit(1)).catch(() => {});
  await app?.close().catch(() => {});
}
