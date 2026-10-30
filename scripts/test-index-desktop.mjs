import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/index-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-index-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", checks: [], errors: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(8000);
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
  const fixture = JSON.parse(
    fs.readFileSync("work/index-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Index desktop",
      template: "blank",
    });
    p.settings = fixture.settings;
    p.styles = fixture.styles;
    p.book = fixture.book;
    p.book.chapters[0].document.content.splice(-1, 1, { type: "paragraph" });
    const blocks=p.book.chapters[0].document.content;
    blocks[0].content.unshift({type:'bookmark',attrs:{blockId:'passage',name:'WholePassage',range:true}});
    blocks[2].content.push({type:'bookmark_end',attrs:{targetId:'passage',name:'WholePassage'}});
    await window.alder.request("PUT", `/api/projects/${p.id}`, {
      project: p,
      expectedRevision: p.revision,
    });
    return p.id;
  }, fixture);
  const reopen = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: "Index desktop" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    markers = editor.locator("[data-index-entry]");
  const menu = async (name) => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  await expect(markers).toHaveCount(6);
  await editor.press("Control+Home");
  await editor.press('ArrowRight'); // Step over the nonprinting range marker.
  await editor.press("Control+Shift+ArrowRight");
  await menu("Index entries…");
  const entries = page.getByRole("dialog", {
    name: "Index entries",
    exact: true,
  });
  await expect(entries.getByLabel("Main entry", { exact: true })).toHaveValue(
    "FIRST",
  );
  await entries.getByLabel("Main entry", { exact: true }).fill("New term");
  await entries.getByLabel('Index page range',{exact:true}).selectOption({label:'WholePassage'});
  await entries.getByRole("button", { name: "Mark", exact: true }).click();
  await expect(markers).toHaveCount(7);
  await editor.press("Control+z");
  await expect(markers).toHaveCount(6);
  await editor.press("Control+y");
  await expect(markers).toHaveCount(7);
  await menu("Index entries…");
  const option = await entries
    .getByLabel("Index entry", { exact: true })
    .locator("option")
    .filter({ hasText: "New term" })
    .getAttribute("value");
  await entries.getByLabel("Index entry", { exact: true }).selectOption(option);
  await entries.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(markers).toHaveCount(6);
  await editor.press("Control+z");
  await expect(markers).toHaveCount(7);
  report.checks.push("Mark/remove and undo preserve authored text");
  await editor.press("Control+End");
  await menu("Insert table of contents…");
  const contents = page.getByRole("dialog", {
    name: "Table of contents",
    exact: true,
  });
  await contents
    .getByLabel("Contents type", { exact: true })
    .selectOption("index");
  await contents
    .getByLabel("Contents entry style", { exact: true })
    .selectOption("indexStyle");
  await contents.getByRole("button", { name: "Insert", exact: true }).click();
  const index = editor.locator("[data-contents-kind=index]");
  await expect(index).toHaveCount(1, { timeout: 20000 });
  await expect(index).toContainText("Alder, 1, 2");
  await expect(index).toContainText("New term, 1–2");
  await expect(index).toContainText("Birch. See Trees");
  await expect(index.locator("p").nth(1)).toHaveCSS("font-family", "Arial");
  await editor.press("Control+z");
  await expect(index).toHaveCount(0);
  await editor.press("Control+y");
  await expect(index).toHaveCount(1);
  report.checks.push(
    "Measured index generation, duplicate-page removal, hierarchy, formatting and one-step undo",
  );
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  for (const scale of ["0.5", "1", "1.5"]) {
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()
        .items.flatMap((m) => m.submenu?.items || [])
        .find((i) => i.label === "Settings…");
      Reflect.apply(item.click, item, [
        { triggeredByAccelerator: false },
        BrowserWindow.getAllWindows()[0],
        {},
      ]);
    });
    await settings
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await settings.getByLabel("UI Scale", { exact: true }).selectOption(scale);
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.locator(".page-sheets > .page-sheet")).toHaveCount(3);
    await expect(index).toContainText("Alder, 1, 2");
    await expect(index).toContainText('New term, 1–2');
  }
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(index).toContainText("Alder, 1, 2");
  await index
    .locator("[data-index-reference]")
    .filter({ hasText: "1, 2" })
    .click({ modifiers: ["Control"] });
  await expect(editor).toBeFocused();
  await expect
    .poll(() =>
      editor.evaluate(() =>
        ((node) =>
          (node?.nodeType === 1 ? node : node?.parentElement)?.closest("p")
            ?.textContent || "")(window.getSelection()?.anchorNode),
      ),
    )
    .toContain("FIRST BODY");
  await editor.press("Control+Home");
  await menu("Insert page break");
  await menu("Update fields");
  await expect(index).toContainText("Alder, 2, 3", { timeout: 20000 });
  await expect(index).toContainText("Apple, 3");
  await expect(index).toContainText('New term, 2–3');
  await expect(index.locator("p").nth(1)).toHaveCSS("font-family", "Arial");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(4);
  await expect(page.locator(".page-card").last()).toContainText("Alder, 2, 3");
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  const pdf = await page.evaluate(async (id) => {
    const result = await window.alder.request(
      "POST",
      `/api/projects/${id}/export`,
      { format: "pdf" },
    );
    return {
      result,
      bytes: [
        ...new Uint8Array(
          await (
            await fetch(window.alder.mediaBase + result.downloadUrl)
          ).arrayBuffer(),
        ),
      ],
    };
  }, id);
  expect(pdf.result.validation.pages).toBe(4);
  fs.writeFileSync(path.join(directory, "index.pdf"), Buffer.from(pdf.bytes));
  const word=await page.evaluate(async id=>{
    const result=await window.alder.request('POST',`/api/projects/${id}/export`,{format:'docx'});
    return {result,bytes:[...new Uint8Array(await(await fetch(window.alder.mediaBase+result.downloadUrl)).arrayBuffer())]};
  },id);
  fs.writeFileSync(path.join(directory,'alder.docx'),Buffer.from(word.bytes));
  fs.writeFileSync(path.join(directory,'fixture-exports.json'),JSON.stringify({docx:{...word.result,path:path.join(directory,'alder.docx')},indexesExpected:1,skipListNumbers:true,expectedText:['FIRST BODY','SECOND BODY','See Trees']}));
  report.checks.push(
    "Persistence, navigation, page changes/Update fields, Arrangement, 50/100/150% UI scale and shared PDF",
  );
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status='failed';
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
