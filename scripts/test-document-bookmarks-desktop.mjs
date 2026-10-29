import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-bookmarks-"));
const report = { status: "running", checks: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Book", exact: false }).click();
  await page.getByLabel("Name", { exact: true }).fill("Bookmark manuscript");
  await page.getByLabel("Chapters", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await editor.fill("First last");
  await editor.press("Control+Home");
  for (let i = 0; i < 5; i++) await editor.press("ArrowRight");
  const open = async () => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Bookmarks…", exact: true })
      .click();
  };
  const dialog = page.getByRole("dialog", {
    name: "Document bookmarks",
    exact: true,
  });
  await open();
  await dialog.getByLabel("Bookmark name", { exact: true }).fill("MyTarget");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(editor).toBeFocused();
  await expect(
    editor.locator('[data-document-bookmark="MyTarget"]'),
  ).toHaveCount(1);
  await expect(editor).toHaveText("First last");
  await page.keyboard.type("X");
  await expect(editor).toHaveText("FirstX last");
  await editor.press("Control+z");
  await expect(editor).toHaveText("First last");
  await open();
  await dialog.getByRole("button", { name: "MyTarget", exact: true }).click();
  await dialog.getByLabel("Bookmark name", { exact: true }).fill("Renamed");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(
    editor.locator('[data-document-bookmark="Renamed"]'),
  ).toHaveCount(1);
  await editor.press("Control+z");
  await expect(
    editor.locator('[data-document-bookmark="MyTarget"]'),
  ).toHaveCount(1);
  await editor.press("Control+End");
  await open();
  await dialog
    .getByRole("button", { name: "Go to MyTarget", exact: true })
    .click();
  await page.keyboard.type("Y");
  await expect(editor).toHaveText("FirstY last");
  await editor.press("Control+z");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const saved = await page.evaluate(() =>
    window.alder.request(
      "GET",
      "/api/projects/" + localStorage.getItem("alder.project"),
    ),
  );
  const bookmark = saved.book.chapters[0].document.content[0].content.find(
    (n) => n.type === "bookmark",
  );
  expect(bookmark.attrs.blockId).toBeTruthy();
  expect(saved.book.chapters[0].text).toBe("First last");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Bookmark manuscript" })
    .click();
  await expect(
    editor.locator('[data-document-bookmark="MyTarget"]'),
  ).toHaveCount(1);
  await open();
  await dialog
    .getByRole("button", { name: "Remove MyTarget", exact: true })
    .click();
  await expect(editor.locator("[data-document-bookmark]")).toHaveCount(0);
  await editor.press("Control+z");
  await expect(
    editor.locator('[data-document-bookmark="MyTarget"]'),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
  report.checks.push(
    "insert, immediate typing, rename, jump, remove and independent undo; autosave/reopen; no added text",
  );
  await page
    .getByRole("button", { name: "Open chapter Chapter 2", exact: true })
    .click();
  await editor.fill("Distant target.");
  await editor.press("Control+Home");
  await open();
  await dialog.getByLabel("Bookmark name", { exact: true }).fill("Distant");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("button", { name: "Open chapter Chapter 1", exact: true })
    .click();
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()
      .items.flatMap((menu) => menu.submenu?.items || [])
      .find((item) => item.label === "Show Outline");
    const win = BrowserWindow.getAllWindows()[0];
    Reflect.apply(item.click, item, [
      { triggeredByAccelerator: false },
      win,
      win.webContents,
    ]);
  });
  const outline = page.getByRole("complementary", {
    name: "Document outline",
    exact: true,
  });
  await outline.getByLabel("Outline contents").selectOption("bookmarks");
  await outline
    .getByRole("searchbox", { name: "Find bookmark" })
    .fill("Distant");
  await outline.getByRole("button", { name: "Distant", exact: true }).click();
  await expect(editor).toHaveText("Distant target.");
  await expect(editor).toBeFocused();
  await outline.getByRole("button", { name: "Close outline" }).click();
  await page
    .getByRole("button", { name: "Open chapter Chapter 1", exact: true })
    .click();
  await editor.press("Control+End");
  await editor.press("Enter");
  await page
    .locator(".book-main .format-toolbar")
    .getByRole("button", { name: "Insert link", exact: true })
    .click();
  const link = page.getByRole("dialog", { name: "Insert link", exact: true });
  await link
    .getByLabel("Link destination")
    .selectOption({ label: "Distant · Chapter 2" });
  await link.getByLabel("Link text", { exact: true }).fill("Go there");
  await link.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(editor).toBeFocused();
  await expect(editor.locator("a")).toHaveText("Go there");
  const href = await editor.locator("a").getAttribute("href");
  expect(href).toMatch(/^#block_/);
  await editor.locator("a").click({ modifiers: ["Control"] });
  await expect(editor).toHaveText("Distant target.");
  await open();
  await dialog.getByRole("button", { name: "Distant", exact: true }).click();
  await dialog.getByLabel("Bookmark name", { exact: true }).fill("MovedTarget");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("button", { name: "Open chapter Chapter 1", exact: true })
    .click();
  expect(await editor.locator("a").getAttribute("href")).toBe(href);
  await editor.locator("a").click({ modifiers: ["Control"] });
  await expect(
    editor.locator('[data-document-bookmark="MovedTarget"]'),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
  report.checks.push(
    "filtered Outline bookmarks and Ctrl-click links navigate across chapters; renaming retains link identity",
  );
  await editor.press('Control+End');
  await editor.press('Enter');
  const paste=async()=>editor.evaluate(element=>{
    const clipboard=new DataTransfer();
    clipboard.setData('text/plain','Copied link');
    clipboard.setData('text/html','<p><span data-document-bookmark="Copied" data-bookmark-id="clipboard-source"></span><a href="#clipboard-source">Copied link</a></p>');
    element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));
  });
  await paste();
  const firstId=await editor.locator('[data-document-bookmark="Copied"]').getAttribute('data-bookmark-id');
  expect(firstId).not.toBe('clipboard-source');
  expect(await editor.locator('a').last().getAttribute('href')).toBe('#'+firstId);
  await editor.press('Control+End');await editor.press('Enter');await paste();
  const secondId=await editor.locator('[data-document-bookmark="Copied_2"]').getAttribute('data-bookmark-id');
  expect(secondId).not.toBe(firstId);
  expect(await editor.locator('a').last().getAttribute('href')).toBe('#'+secondId);
  await editor.press('Control+z');
  await expect(editor.locator('[data-document-bookmark="Copied_2"]')).toHaveCount(0);
  await expect(editor.locator('[data-document-bookmark="Copied"]')).toHaveCount(1);
  expect(errors).toEqual([]);
  report.checks.push('HTML paste gives copied bookmarks independent identities and retargets only their own links; duplicate names and undo stay consistent');
  await editor.press('Control+a');await editor.pressSequentially('Alpha beta gamma.');
  await editor.press('Control+Home');for(let i=0;i<6;i++)await editor.press('ArrowRight');
  for(let i=0;i<4;i++)await editor.press('Shift+ArrowRight');
  await open();await dialog.getByLabel('Bookmark name',{exact:true}).fill('Passage');
  await dialog.getByRole('button',{name:'Add',exact:true}).click();
  await expect(editor).toBeFocused();
  expect(await page.evaluate(()=>getSelection().toString())).toBe('beta');
  const rangeId=await editor.locator('[data-document-bookmark="Passage"]').getAttribute('data-bookmark-id');
  await expect(editor.locator(`[data-bookmark-end="${rangeId}"]`)).toHaveCount(1);
  await editor.press('Control+End');await open();
  await dialog.getByRole('button',{name:'Go to Passage',exact:true}).click();
  expect(await page.evaluate(()=>getSelection().toString())).toBe('beta');
  await editor.press('ArrowLeft');await page.keyboard.type('new ');
  await editor.press('Control+End');await open();
  await dialog.getByRole('button',{name:'Go to Passage',exact:true}).click();
  expect(await page.evaluate(()=>getSelection().toString())).toBe('new beta');
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.reload();await page.getByRole('button',{name:'Open',exact:true}).click();
  await page.locator('.project-list-item').filter({hasText:'Bookmark manuscript'}).click();
  await page.getByRole('button',{name:'Open chapter Chapter 2',exact:true}).click();
  await open();await dialog.getByRole('button',{name:'Go to Passage',exact:true}).click();
  expect(await page.evaluate(()=>getSelection().toString())).toBe('new beta');
  const rangeHtml=await editor.innerHTML();await editor.press('Control+End');await editor.press('Enter');
  await editor.evaluate((element,html)=>{const data=new DataTransfer();data.setData('text/html',html);data.setData('text/plain','Alpha new beta gamma.');element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},rangeHtml);
  const copyId=await editor.locator('[data-document-bookmark="Passage_2"]').getAttribute('data-bookmark-id');
  expect(copyId).not.toBe(rangeId);
  await expect(editor.locator(`[data-bookmark-end="${copyId}"]`)).toHaveCount(1);
  await open();await dialog.getByRole('button',{name:'Go to Passage_2',exact:true}).click();
  expect(await page.evaluate(()=>getSelection().toString())).toBe('new beta');
  await open();await dialog.getByRole('button',{name:'Remove Passage_2',exact:true}).click();
  await expect(editor.locator(`[data-bookmark-end="${copyId}"]`)).toHaveCount(0);
  await editor.press('Control+z');await expect(editor.locator(`[data-bookmark-end="${copyId}"]`)).toHaveCount(1);
  expect(errors).toEqual([]);
  report.checks.push('Passage bookmarks follow editing, select their text, survive save/reopen, copy as independent paired ranges and remove/undo together.');
  report.status = "passed";
} catch (error) {
  report.error = error.stack;
  await page
    ?.screenshot({ path: "work/document-bookmarks-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    "work/document-bookmarks-report.json",
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
