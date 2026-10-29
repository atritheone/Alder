import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-word-processing-"));
const report = "work/word-processing-report.json";
const checks = [];
let app;
let page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByRole("button", { name: "Word Document", exact: false })
    .click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const toolbar = page.locator(".book-main .format-toolbar");
  const nativeAction = async (label) =>
    app.evaluate(({ Menu, BrowserWindow }, label) => {
      const item = Menu.getApplicationMenu()
        .items.flatMap((menu) => menu.submenu?.items || [])
        .find((item) => item.label === label);
      if (!item) throw new Error(`Missing native command: ${label}`);
      const win = BrowserWindow.getAllWindows()[0];
      Reflect.apply(item.click, item, [
        { triggeredByAccelerator: false },
        win,
        win.webContents,
      ]);
    }, label);
  await editor.fill("Alpha beta alpha.");
  await editor.press("ControlOrMeta+a");
  const size = toolbar.getByRole("textbox", { name: "Font size", exact: true });
  await expect(size).toHaveValue("12");
  await size.fill("13.5");
  await size.press("Enter");
  await expect(editor.locator("span[style]").first()).toHaveCSS(
    "font-size",
    "18px",
  );
  await editor.press("ControlOrMeta+Home");
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("");
  await editor.press("ControlOrMeta+Shift+ArrowRight");
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().trim()))
    .toBe("Alpha");
  await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
  await editor.press("ControlOrMeta+a");
  await expect(
    toolbar.getByRole("button", { name: "Bold", exact: true }),
  ).toHaveAttribute("aria-pressed", "mixed");
  checks.push("editable font size; mixed selection state");
  // Stub this test process's read API without touching the user's OS clipboard.
  await app.evaluate(({ clipboard, ClipboardItem }) => {
    clipboard.read = async () => [
      new ClipboardItem({
        "text/plain": "Clipboard wording",
        "text/html":
          '<p><a href="https://example.org"><strong><span style="color:#123456;font-size:20pt">Clipboard wording</span></strong></a><script>throw Error("active clipboard")</script></p>',
      }),
    ];
  });
  for (const label of [
    "Paste keeping formatting",
    "Paste matching destination",
    "Paste plain text",
  ]) {
    await editor.press("ControlOrMeta+a");
    await toolbar
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    await expect(editor).toHaveText("Clipboard wording");
    if (label === "Paste keeping formatting")
      await expect(editor.locator("span").first()).toHaveCSS(
        "color",
        "rgb(18, 52, 86)",
      );
    if (label === "Paste matching destination") {
      await expect(editor.locator("a")).toHaveCount(1);
      await expect(editor.locator("strong")).toHaveCount(1);
      await expect(editor.locator("span[style]")).toHaveCount(0);
    }
    if (label === "Paste plain text")
      await expect(editor.locator("a,strong")).toHaveCount(0);
    await editor.press("ControlOrMeta+z");
    await expect(editor).toHaveText("Alpha beta alpha.");
  }
  checks.push(
    "three paste policies; semantic links retained; active HTML omitted; undo",
  );
  const remotePasteRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("example.invalid/clipboard"))
      remotePasteRequests.push(request.url());
  });
  for (const source of [
    "https://example.invalid/clipboard.png",
    "/api/projects/other/assets/foreign",
  ]) {
    await editor.press("ControlOrMeta+a");
    await editor.evaluate((element, source) => {
      const data = new DataTransfer();
      data.setData("text/plain", "Image alternative");
      data.setData(
        "text/html",
        `<p><img src="${source}" data-asset-id="foreign" alt="Image alternative"></p>`,
      );
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, source);
    await expect(editor).toHaveText("Image alternative");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "clipboard images could not be collected" }),
    ).toBeVisible();
    expect(remotePasteRequests).toEqual([]);
    await editor.press("ControlOrMeta+z");
    await expect(editor).toHaveText("Alpha beta alpha.");
  }
  checks.push(
    "native paste shares policy; remote and foreign-document images remain inert with a visible conversion notice",
  );
  await toolbar.getByRole("button", { name: "More formatting" }).click();
  await page.getByRole("menuitem", { name: "Paragraph…", exact: true }).click();
  const paragraph = page.getByRole("dialog", {
    name: "Paragraph",
    exact: true,
  });
  await paragraph.getByLabel("Right indent (pt)", { exact: true }).fill("24");
  await paragraph.getByLabel("Space before (pt)", { exact: true }).fill("9");
  await paragraph
    .getByLabel("Line spacing mode", { exact: true })
    .selectOption("exact");
  await paragraph.getByLabel("Line spacing (pt)", { exact: true }).fill("19.5");
  await paragraph
    .getByLabel("Keep lines together", { exact: true })
    .selectOption("true");
  await paragraph
    .getByLabel("Widow and orphan control", { exact: true })
    .selectOption("false");
  await page.screenshot({ path: "work/word-processing-paragraph.png" });
  await paragraph.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(editor.locator("p").first()).toHaveCSS("margin-right", "32px");
  await expect(editor.locator("p").first()).toHaveCSS("line-height", "26px");
  await expect(editor.locator("p").first()).toHaveCSS("break-inside", "avoid");
  await expect(editor.locator("p").first()).toHaveCSS("orphans", "1");
  await editor.focus();
  await editor.press("ControlOrMeta+z");
  await expect(editor.locator("p").first()).toHaveCSS("margin-right", "0px");
  checks.push("paragraph properties; selection preservation; undo");

  await editor.press("ControlOrMeta+Home");
  await editor.press("ControlOrMeta+f");
  const find = page.getByRole("complementary", {
    name: "Find and replace",
    exact: true,
  });
  await find.getByRole("searchbox", { name: "Find text" }).fill("alpha");
  await expect(find.getByRole("status")).toHaveText("2 matches");
  await find.getByRole("textbox", { name: "Replacement text" }).fill("Omega");
  await find.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(editor).toHaveText("Omega beta Omega.");
  await find.getByRole("button", { name: "Close find and replace" }).click();
  await editor.press("ControlOrMeta+z");
  await expect(editor).toHaveText("Alpha beta alpha.");
  checks.push("case-insensitive find; replace all; single-step undo");

  await editor.press("ControlOrMeta+a");
  await editor.evaluate((element) => {
    const data = new DataTransfer();
    data.setData(
      "text/html",
      "<h1>Introduction</h1><p>First section.</p><h2>Details</h2><p>Nested content.</p><h1>Conclusion</h1><p>Last section.</p>",
    );
    data.setData(
      "text/plain",
      "Introduction\nFirst section.\nDetails\nNested content.\nConclusion\nLast section.",
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor.locator("h1")).toHaveCount(2);
  await nativeAction("Show Outline");
  const outline = page.getByRole("complementary", {
    name: "Document outline",
    exact: true,
  });
  await outline
    .getByRole("button", { name: "Collapse Introduction", exact: true })
    .click();
  await expect(
    outline.getByRole("button", { name: "Details", exact: true }),
  ).toHaveCount(0);
  await outline
    .getByRole("searchbox", { name: "Find heading" })
    .fill("Details");
  await expect(
    outline.getByRole("button", { name: "Details", exact: true }),
  ).toBeVisible();
  await outline.getByRole("searchbox", { name: "Find heading" }).fill("");
  await outline
    .getByRole("button", { name: "Introduction", exact: true })
    .click();
  await outline.getByRole("button", { name: "Move heading down" }).click();
  await expect(editor.locator("h1").first()).toHaveText("Conclusion");
  await expect(editor).toHaveText(
    "ConclusionLast section.IntroductionFirst section.DetailsNested content.",
  );
  await editor.press("ControlOrMeta+z");
  await expect(editor.locator("h1").first()).toHaveText("Introduction");
  await outline.getByRole("button", { name: "Close outline" }).click();
  await editor.press("ControlOrMeta+z");
  await expect(editor).toHaveText("Alpha beta alpha.");
  checks.push(
    "outline search/collapse; section move includes subordinate content; isolated undo",
  );

  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await toolbar
    .getByRole("button", { name: "Insert table", exact: true })
    .click();
  const tableDialog = page.getByRole("dialog", {
    name: "Insert table",
    exact: true,
  });
  await tableDialog.getByLabel("Table rows").fill("2");
  await tableDialog.getByLabel("Table columns").fill("2");
  await tableDialog
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  await expect(editor.locator("td")).toHaveCount(4);
  await editor.locator("td").first().click();
  await editor.pressSequentially("First cell");
  await editor.press("Tab");
  await editor.pressSequentially("Second cell");
  await expect(editor.locator("td").nth(1)).toHaveText("Second cell");
  await toolbar.getByRole("button", { name: "More formatting" }).click();
  await page
    .getByRole("menuitem", { name: "Insert row below", exact: true })
    .click();
  await expect(editor.locator("tr")).toHaveCount(3);
  checks.push("table dimensions; keyboard navigation; contextual row actions");

  const other = path.join(data, "Other.txt");
  fs.writeFileSync(other, "Other document.");
  await page.locator('input[aria-label="Open documents"]').setInputFiles(other);
  await expect(editor).toHaveText("Other document.");
  await page.getByRole("tab", { name: "Untitled", exact: true }).click();
  await expect(editor.locator("tr")).toHaveCount(3);
  await editor.focus();
  await editor.press("ControlOrMeta+z");
  await expect(editor.locator("tr")).toHaveCount(2);
  checks.push("undo history after document switch");

  await page.getByRole("tab", { name: "Other", exact: true }).click();
  await expect(editor).toHaveText("Other document.");
  await editor.fill("Saved to the same file.");
  await expect(editor).toHaveText("Saved to the same file.");
  await editor.press("ControlOrMeta+s");
  await expect
    .poll(() => fs.readFileSync(other, "utf8").trim())
    .toBe("Saved to the same file.");
  fs.writeFileSync(other, "Edited outside Alder.");
  await editor.fill("Keep this local change.");
  await editor.press("ControlOrMeta+s");
  await expect(
    page.getByRole("alert").filter({ hasText: "changed outside Alder" }),
  ).toBeVisible();
  expect(fs.readFileSync(other, "utf8")).toBe("Edited outside Alder.");
  checks.push("Save uses original path; external change protection");

  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  const oldHint = await page.locator(".status-hint").innerText();
  await nativeAction("Save As…");
  await expect(page.locator(".status-hint")).toHaveText(oldHint);
  const destination = path.join(data, "Saved-as.txt");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, destination);
  await nativeAction("Save As…");
  await expect
    .poll(
      () =>
        fs.existsSync(destination) &&
        fs.readFileSync(destination, "utf8").trim(),
    )
    .toBe("Keep this local change.");
  const copy = path.join(data, "Copy.txt");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, copy);
  await nativeAction("Save A Copy…");
  await expect
    .poll(() => fs.existsSync(copy) && fs.readFileSync(copy, "utf8").trim())
    .toBe("Keep this local change.");
  await editor.fill("Later edit.");
  await editor.press("ControlOrMeta+s");
  await expect
    .poll(() => fs.readFileSync(destination, "utf8").trim())
    .toBe("Later edit.");
  expect(fs.readFileSync(copy, "utf8").trim()).toBe("Keep this local change.");
  await page
    .locator('input[aria-label="Open documents"]')
    .setInputFiles(destination);
  await expect(
    page.getByRole("tab", { name: "Other", exact: true }),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("tablist", { name: "Open documents", exact: true })
      .getByRole("tab"),
  ).toHaveCount(2);
  checks.push(
    "Save As and Save a Copy; cancellation; reopening uses existing tab",
  );

  await nativeAction("Saved Versions…");
  const versions = page.getByRole("dialog", {
    name: "Saved versions",
    exact: true,
  });
  await expect(
    versions
      .getByLabel("Saved version", { exact: true })
      .locator("option")
      .first(),
  ).toBeAttached();
  await versions
    .getByLabel("Saved version", { exact: true })
    .selectOption({ index: 0 });
  await versions
    .getByRole("button", { name: "Recover a copy", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Other — recovered", exact: true }),
  ).toBeVisible();
  await expect(editor).toHaveText("Later edit.");
  await editor.press("ControlOrMeta+z");
  await expect(editor).toHaveText("Later edit.");
  checks.push(
    "version recovery opens independent copy with isolated undo history",
  );

  await nativeAction("Print…");
  const publication = page.getByRole("region", {
    name: "Publication preview",
    exact: true,
  });
  await expect(publication.locator("canvas")).toBeVisible();
  const proofWindow = app.waitForEvent("window");
  await publication
    .getByRole("button", { name: "Print this PDF…", exact: true })
    .click();
  await proofWindow;
  const printFile = fileURLToPath(
    await app.evaluate(({ BrowserWindow }) => {
      const child = BrowserWindow.getAllWindows().find((win) =>
        win.getTitle().startsWith("Print —"),
      );
      if (!child) throw new Error("PDF print window missing");
      return child.webContents.getURL();
    }),
  );
  expect(fs.readFileSync(printFile).subarray(0, 5).toString()).toBe("%PDF-");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((win) => win.getTitle().startsWith("Print —"))
      ?.close();
  });
  await expect.poll(() => fs.existsSync(printFile)).toBe(false);
  await publication
    .getByRole("button", { name: "Back To Write", exact: true })
    .click();
  await expect(editor).toHaveText("Later edit.");
  checks.push(
    "File Print uses a generated PDF proof; closing preview clears its temporary file; no physical printing",
  );

  await nativeAction("Settings…");
  let typingSettings = page.getByRole("dialog", {
    name: "Settings",
    exact: true,
  });
  await typingSettings
    .getByRole("tab", { name: "Writing", exact: true })
    .click();
  await expect(
    typingSettings.getByLabel("Smart quotes", { exact: true }),
  ).not.toBeChecked();
  await typingSettings.getByLabel("Smart quotes", { exact: true }).check();
  await typingSettings
    .getByLabel("Replace double hyphens with an em dash", { exact: true })
    .check();
  await typingSettings
    .getByLabel("Start lists automatically", { exact: true })
    .check();
  await typingSettings
    .locator("summary", { hasText: "Text replacements" })
    .click();
  await typingSettings
    .getByRole("button", { name: "Add replacement", exact: true })
    .click();
  await typingSettings
    .getByLabel("Replace word 1", { exact: true })
    .fill("teh");
  await typingSettings.getByLabel("Replacement 1", { exact: true }).fill("the");
  await typingSettings
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await editor.fill("");
  await editor.pressSequentially('"Hello" -- teh ');
  await expect(editor).toHaveText("“Hello” — the ");
  await editor.press("Backspace");
  await expect(editor).toHaveText("“Hello” — teh ");
  await editor.fill("");
  await editor.pressSequentially("4. ");
  await expect(editor.locator("ol")).toHaveAttribute("start", "4");
  await editor.press("Backspace");
  await expect(editor.locator("ol")).toHaveCount(0);
  await expect(editor).toHaveText("4. ");
  await editor.fill("");
  await editor.pressSequentially("4. First item");
  await editor.press("Enter");
  await editor.pressSequentially("Second item");
  await toolbar
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "List…", exact: true }).click();
  const listDialog = page.getByRole("dialog", { name: "List", exact: true });
  await listDialog
    .getByLabel("List markers", { exact: true })
    .selectOption("upper-roman");
  await listDialog.getByLabel("List start", { exact: true }).fill("10");
  await listDialog
    .getByLabel("List scope", { exact: true })
    .selectOption("true");
  await listDialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(editor.locator("ol")).toHaveCount(2);
  await expect(editor.locator("ol").last()).toHaveAttribute("start", "10");
  await expect(editor.locator("ol").last()).toHaveCSS(
    "list-style-type",
    "upper-roman",
  );
  await editor.press("ControlOrMeta+z");
  await expect(editor.locator("ol")).toHaveCount(1);
  await expect(editor.locator("li")).toHaveCount(2);
  checks.push(
    "contextual list markers/start/restart at item; single-step undo",
  );
  // Exercise the editor's select-all command after list undo. Direct DOM fill
  // can race the browser's selectionchange and append to the last list item.
  await editor.press("ControlOrMeta+a");
  await editor.pressSequentially("Typing preferences persisted.");
  await expect(editor).toHaveText("Typing preferences persisted.");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const workspaceName = await page.evaluate(
    async () =>
      (
        await window.alder.request(
          "GET",
          `/api/projects/${localStorage.getItem("alder.project")}`,
        )
      ).name,
  );
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: workspaceName })
    .click();
  await expect(editor).toHaveText("Typing preferences persisted.");
  await nativeAction("Settings…");
  typingSettings = page.getByRole("dialog", { name: "Settings", exact: true });
  await typingSettings
    .getByRole("tab", { name: "Writing", exact: true })
    .click();
  await expect(
    typingSettings.getByLabel("Smart quotes", { exact: true }),
  ).toBeChecked();
  await typingSettings
    .locator("summary", { hasText: "Text replacements" })
    .click();
  await expect(
    typingSettings.getByLabel("Replacement 1", { exact: true }),
  ).toHaveValue("the");
  await typingSettings
    .getByRole("button", { name: "Done", exact: true })
    .click();
  checks.push(
    "typing preferences persist; optional quotes/dashes/personal replacements and genuine list starts; immediate Backspace undo",
  );

  await editor.focus();
  await editor.press("ControlOrMeta+a");
  await editor.evaluate((element) => {
    const data = new DataTransfer();
    data.setData(
      "text/html",
      "<table><tr><th>Alpha</th><th>One</th></tr><tr><td>Beta</td><td>Two</td></tr><tr><td>Gamma</td><td>Three</td></tr></table>",
    );
    data.setData("text/plain", "Alpha One Beta Two Gamma Three");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor.locator("tr")).toHaveCount(3);
  await editor.locator("tr").nth(1).locator("td").first().click();
  const tableAction = async (name) => {
    await toolbar
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  await tableAction("Move rows down");
  await expect(editor.locator("tr").nth(1)).toHaveText("GammaThree");
  await expect(editor.locator("tr").nth(2)).toHaveText("BetaTwo");
  await tableAction("Move rows up");
  await expect(editor.locator("tr").nth(1)).toHaveText("BetaTwo");
  await tableAction("Split table before this row");
  await expect(editor.locator("table")).toHaveCount(2);
  await expect(editor.locator("table").nth(0)).toHaveText("AlphaOne");
  await expect(editor.locator("table").nth(1)).toHaveText("BetaTwoGammaThree");
  await tableAction("Join with previous table");
  await expect(editor.locator("table")).toHaveCount(1);
  await editor.press("ControlOrMeta+z");
  await expect(editor.locator("table")).toHaveCount(2);
  await editor.press("ControlOrMeta+z");
  await expect(editor.locator("table")).toHaveCount(1);
  await expect(editor.locator("table")).toHaveText("AlphaOneBetaTwoGammaThree");
  checks.push(
    "move table rows; split and join tables; header cells and wording preserved; individual undo steps",
  );

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.unmaximize();
    win.setSize(900, 800);
  });
  for (const scale of ["0.5", "1", "1.5"]) {
    await nativeAction("Settings…");
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await settings
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await settings.getByLabel("UI Scale", { exact: true }).selectOption(scale);
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await toolbar
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Paragraph…", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Paragraph", exact: true });
    const bounds = await dialog.boundingBox();
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  checks.push(
    "formatting overflow and paragraph dialog at 50%, 100%, 150% UI scale",
  );
  expect(errors).toEqual([]);
  fs.writeFileSync(
    report,
    JSON.stringify({ status: "passed", checks, errors }, null, 2),
  );
} catch (error) {
  const content = await page
    ?.locator("body")
    .innerText()
    .catch(() => "Unavailable");
  await page
    ?.screenshot({ path: "work/word-processing-failure.png" })
    .catch(() => {});
  fs.writeFileSync(
    report,
    JSON.stringify(
      { status: "failed", checks, error: error.stack, content },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close();
}
