import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-arrangement-"));
let page;
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  timeout: 60000,
});
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 900),
  );
  // Keep animation frames running normally during native pointer drags.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].showInactive(),
  );
  page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(() => {
    const original = globalThis.fetch;
    const jobs=new Map();
    globalThis.fetch = async (...args) => {
      const url=String(args[0]);
      if(url.includes('/api/proofreading/jobs/')){
        const id=url.split('/').at(-1);
        if(args[1]?.method==='DELETE'){jobs.delete(id);return Response.json({});}
        if(jobs.has(id))return Response.json(jobs.get(id));
      }
      if (url.endsWith("/api/proofreading/check")) {
        const {text,targetId} = JSON.parse(args[1].body);
        const result={
          id:crypto.randomUUID(),targetId,sourceText:text,status:'completed',stage:'complete',message:'',sequence:1,warnings:[],truncated:false,
          coverage:{totalBlocks:1,checkedBlocks:1,advancedBlocks:0,skippedBlocks:0},
          words: 2,
          sentences: 1,
          annotations: text
            ? [
                {
                  id: "spelling-test",
                  type: "spelling",
                  start: 0,
                  end: Math.min(5, text.length),
                  message: "Check spelling",
                  rule: "spelling",
                },
                {
                  id: "grammar-test",
                  type: "formatting",
                  start: 6,
                  end: Math.min(10, text.length),
                  message: "Check punctuation",
                  rule: "punctuation",
                },
              ]
            : [],
        };
        jobs.set(result.id,result);return Response.json(result);
      }
      return original(...args);
    };
  });
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const writeTools = page.locator(".book-main .format-toolbar");
  const spell = writeTools.getByRole("button", {
    name: "Spelling and grammar",
    exact: true,
  });
  const letterCase = writeTools.getByRole("combobox", {
    name: "Case",
    exact: true,
  });
  await editor.fill("First SELECTED end.");
  await expect(editor.locator(".annotation-spelling")).toHaveCount(1);
  await expect(editor.locator(".annotation-grammar")).toHaveCount(1);
  await expect(editor.locator(".annotation-spelling")).toHaveCSS(
    "background-size",
    "12px 2px",
  );
  await expect(editor.locator(".annotation-spelling")).toHaveCSS(
    "--check-color",
    "#c53030",
  );
  await expect(editor.locator(".annotation-grammar")).toHaveCSS(
    "background-size",
    "12px 2px",
  );
  await expect(editor.locator(".annotation-grammar")).toHaveCSS(
    "--check-color",
    "#24803b",
  );
  await spell.click();
  await expect(spell).toHaveAttribute("aria-pressed", "false");
  await expect(editor.locator(".annotation")).toHaveCount(0);
  await editor.focus();
  await editor.press("ControlOrMeta+Home");
  for (let i = 0; i < 6; i++) await editor.press("ArrowRight");
  for (let i = 0; i < 8; i++) await editor.press("Shift+ArrowRight");
  await letterCase.selectOption("lower");
  await expect(editor).toHaveText("First selected end.");
  await editor.press("ControlOrMeta+z");
  await expect(editor).toHaveText("First SELECTED end.");
  await editor.press("ArrowRight");
  await expect(letterCase).toBeEnabled();
  await expect(letterCase).toHaveValue("lower");
  await letterCase.selectOption("upper");
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially(" new text");
  await expect(editor).toHaveText("First SELECTED end. NEW TEXT");
  await letterCase.selectOption("free");
  await editor.pressSequentially(" Mixed");
  await expect(editor).toHaveText("First SELECTED end. NEW TEXT Mixed");
  await page.keyboard.insertText(' café Ελληνικά 日本語');
  await expect(editor).toHaveText('First SELECTED end. NEW TEXT Mixed café Ελληνικά 日本語');
  const sandboxToggle = page.getByRole("button", {
    name: "Toggle sandbox",
    exact: true,
  });
  if ((await sandboxToggle.getAttribute("aria-expanded")) === "false")
    await sandboxToggle.click();
  await page
    .locator(".detail-heading")
    .getByRole("tab", { name: "Sandbox", exact: true })
    .click();
  const sandbox = page.getByRole("textbox", {
    name: "Sandbox text editor",
    exact: true,
  });
  const sandboxTools = page.locator(".detail-pane .format-toolbar");
  const sandboxSpell = sandboxTools.getByRole("button", {
    name: "Spelling and grammar",
    exact: true,
  });
  await expect(sandboxSpell).toHaveAttribute("aria-pressed", "true");
  await sandbox.fill("first line.\nsecond LINE.");
  await expect(sandbox.locator(".annotation-spelling")).toHaveCount(1);
  await sandbox.press("ControlOrMeta+Home");
  await sandbox.press("Shift+ArrowRight");
  await sandboxTools
    .getByRole("combobox", { name: "Case", exact: true })
    .selectOption("upper");
  await expect(sandbox).toContainText("FIRST LINE.");
  await expect(sandbox).toContainText("SECOND LINE.");
  await sandbox.press('ControlOrMeta+End');
  await sandbox.pressSequentially(' added');
  await expect(sandbox).toContainText('SECOND LINE. ADDED');
  await sandboxTools.getByRole('combobox',{name:'Case',exact:true}).selectOption('free');
  await page.keyboard.insertText(' café Ελληνικά 日本語');
  await expect(sandbox).toContainText('ADDED café Ελληνικά 日本語');
  await expect(sandbox.locator(".annotation-grammar")).toHaveCount(1);
  await sandboxSpell.click();
  await expect(sandbox.locator(".annotation")).toHaveCount(0);
  await expect(sandboxSpell).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator(".project-list-item").first().click();
  await expect(editor).toBeVisible();
  if ((await sandboxToggle.getAttribute("aria-expanded")) === "false")
    await sandboxToggle.click();
  await page
    .locator(".detail-heading")
    .getByRole("tab", { name: "Sandbox", exact: true })
    .click();
  await expect(spell).toHaveAttribute("aria-pressed", "false");
  await expect(sandboxSpell).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
  console.log(
    "Toolbar desktop checks passed: independent persisted spellcheck, annotation visibility, selected Write case, whole Sandbox case, and undo.",
  );
  fs.writeFileSync('work/toolbar-options-report.json',JSON.stringify({status:'passed',errors}));
} catch(error) {
  fs.writeFileSync('work/toolbar-options-report.json',JSON.stringify({status:'failed',error:String(error.stack||error)}));
  await page?.screenshot({path:'work/toolbar-options-failure.png'}).catch(()=>{});
  throw error;
} finally {
  await app.close();
}
