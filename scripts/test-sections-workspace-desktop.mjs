import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-section-workspace-"));
const report = { status: "running", checks: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(5000);
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
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()
      .items.flatMap((menu) => menu.submenu?.items || [])
      .find((item) => item.label === "Settings…");
    Reflect.apply(item.click, item, [
      { triggeredByAccelerator: false },
      BrowserWindow.getAllWindows()[0],
      {},
    ]);
  });
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("tab", { name: "Page Layout", exact: true }).click();
  await settings.getByLabel("Page numbers in footer", { exact: true }).check();
  await settings
    .getByLabel("Page number format", { exact: true })
    .selectOption("lowerRoman");
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await editor.fill("First sentence.");
  await editor.press("End");
  const more = () =>
    page
      .locator(".book-editor")
      .getByRole("button", { name: "More formatting" })
      .click();
  await more();
  await page.getByRole("menuitem", { name: /^Insert section break/ }).click();
  await page.getByLabel("Section paper", { exact: true }).selectOption("A4");
  await page
    .getByLabel("Section orientation", { exact: true })
    .selectOption("landscape");
  await expect(
    page.getByLabel("Section top margin", { exact: true }),
  ).toHaveValue("22");
  await page
    .getByLabel("Section page numbering", { exact: true })
    .selectOption("restart");
  await page
    .getByLabel("Section starting page number", { exact: true })
    .fill("28");
  await page
    .getByLabel("Section number format", { exact: true })
    .selectOption("upperLetter");
  await page.screenshot({ path: "work/section-dialog.png" });
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Insert section break", exact: true }),
  ).toHaveCount(0);
  await expect(editor).toBeFocused();
  await page.keyboard.type("Second sentence. A distant paragraph.");
  await expect(page.locator(".book-editor .page-sheet")).toHaveCount(2);
  await expect(page.locator(".book-editor .page-sheet").nth(1)).toContainText(
    "BB",
  );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const saved = () =>
    page.evaluate(() =>
      window.alder.request(
        "GET",
        `/api/projects/${localStorage.getItem("alder.project")}`,
      ),
    );
  const original = await saved();
  const boundary = original.book.chapters[0].document.content.find(
    (n) => n.type === "section_break",
  );
  expect(boundary.attrs.numberingStart).toBe(28);
  expect(boundary.attrs.numberingFormat).toBe("upperLetter");
  expect(
    original.book.chapters[0].document.content.filter(
      (n) => n.type === "section_break",
    ),
  ).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .getByRole("button", { name: original.name, exact: true })
    .first()
    .click();
  await expect(editor).toContainText("Second sentence.");
  await expect(page.locator(".book-editor .page-sheet")).toHaveCount(2);
  expect((await saved()).book.chapters[0].document).toEqual(
    original.book.chapters[0].document,
  );
  await editor.press("Control+End");
  await more();
  await page.getByRole("menuitem", { name: /^Section properties/ }).click();
  await page.getByRole("button", { name: "Remove break", exact: true }).click();
  await expect(page.locator(".book-editor .page-sheet")).toHaveCount(1);
  await expect(editor).toContainText("Second sentence.");
  await page
    .locator(".book-editor")
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(page.locator(".book-editor .page-sheet")).toHaveCount(2);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  expect((await saved()).book.chapters[0].document).toEqual(
    original.book.chapters[0].document,
  );
  report.checks.push(
    "remove section boundary without losing text, then undo to restore its complete settings",
  );
  report.checks.push("new section, immediate typing, durable save and reopen");
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  const cards = page.locator(".page-card");
  await expect(cards).toHaveCount(2);
  const shapes = await cards
    .locator(".page-miniature")
    .evaluateAll((nodes) =>
      nodes.map((e) => [parseFloat(e.style.width), parseFloat(e.style.height)]),
    );
  expect(shapes[0][0]).toBeLessThan(shapes[0][1]);
  expect(shapes[1][0]).toBeGreaterThan(shapes[1][1]);
  await cards.nth(1).dblclick({ position: { x: 10, y: 10 } });
  const focused = page.getByRole("dialog", { name: "Page 2 focused view" });
  await expect(focused).toBeVisible();
  expect(
    await focused
      .locator(".focused-page-sheet")
      .evaluate((e) => e.clientWidth / e.clientHeight),
  ).toBeGreaterThan(1);
  await page.keyboard.press("Escape");
  await expect(focused).toHaveCount(0);
  // Actual pointer input moves a sentence across differently sized page snapshots.
  const source = cards
    .nth(1)
    .locator(".unit-sentence")
    .filter({ has: page.locator(".unit-outline") })
    .first();
  const target = cards.nth(0).locator(".unit-sentence .unit-outline").first();
  const a = await source.locator(".unit-outline").first().boundingBox(),
    b = await target.boundingBox();
  await page.mouse.move(a.x + 1, a.y + 1);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2, { steps: 8 });
  await expect(page.locator(".unit-held")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".unit-held")).toHaveCount(0);
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await expect(editor.locator("p").first()).toContainText("Second sentence.");
  await expect(editor).toContainText("A distant paragraph.");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const moved = await saved();
  expect(
    moved.book.chapters[0].document.content.filter(
      (n) => n.type === "section_break",
    ),
  ).toEqual(
    original.book.chapters[0].document.content.filter(
      (n) => n.type === "section_break",
    ),
  );
  report.checks.push(
    "Arrangement mixed page sizes, focus, sentence move across sections without moving section settings",
  );
  await editor.press("Control+End");
  await editor.press("Enter");
  await page.keyboard.type("THIRD_PAGE");
  await editor.press("Home");
  await more();
  await page
    .getByRole("menuitem", { name: "Insert page break", exact: true })
    .click();
  await expect(page.locator(".book-editor .page-sheet")).toHaveCount(3);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const beforePages = (await saved()).book.chapters[0].document;
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(cards).toHaveCount(3);
  await cards.nth(1).focus();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "Move page earlier", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "Move page later", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  const pageSource = await cards.nth(2).boundingBox(),
    pageTarget = await cards.nth(1).boundingBox();
  await page.mouse.move(pageSource.x + 8, pageSource.y + 8);
  await page.mouse.down();
  await page.mouse.move(pageTarget.x + 8, pageTarget.y + 8, { steps: 10 });
  await expect(page.locator(".page-card.is-held")).toHaveCount(1);
  await page.mouse.up();
  await expect(cards.nth(1)).toContainText("THIRD_PAGE");
  await cards.nth(1).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(cards.nth(2)).toContainText("THIRD_PAGE");
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await page
    .locator(".book-editor")
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await page
    .locator(".book-editor")
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  expect((await saved()).book.chapters[0].document).toEqual(beforePages);
  report.checks.push(
    "page drag, keyboard movement and context-menu availability respect sections; separate undo restores the complete source",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  await page
    ?.screenshot({ path: "work/section-workspace-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    "work/section-workspace-report.json",
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
