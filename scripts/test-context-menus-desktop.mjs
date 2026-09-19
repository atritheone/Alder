import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-arrangement-"));
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
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
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const menu = page.locator(".alder-context-menu");
  await editor.fill("First sentence. Second sentence.");
  await editor.press("ControlOrMeta+A");
  await editor.click({ button: "right" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Copy", exact: true }).click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain(
    "First sentence.",
  );
  await editor.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Cut", exact: true }).click();
  await expect(editor).toHaveText("");
  await editor.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Undo", exact: true }).click();
  await expect(editor).toHaveText("First sentence. Second sentence.");
  await editor.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Redo", exact: true }).click();
  await expect(editor).toHaveText("");
  await editor.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Paste", exact: true }).click();
  await expect(editor).toHaveText("First sentence. Second sentence.");
  await editor.click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(editor).toBeFocused();

  const toggle = page.getByRole("button", {
    name: "Toggle Left Panel",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  const browser = page.getByRole("complementary", { name: "Language browser" });
  await browser.getByRole("button", { name: "Voices", exact: true }).click();
  const plus = page.getByRole("button", {
    name: "Add or create dictionary",
    exact: true,
  });
  await plus.click();
  await expect(menu).toHaveClass(/dictionary-add-menu/);
  const style = await menu.evaluate((el) => {
    const s = getComputedStyle(el),
      b = getComputedStyle(el.querySelector("button"));
    return [
      s.borderRadius,
      s.backgroundColor,
      s.borderTopColor,
      b.padding,
      b.minHeight,
    ];
  });
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  const rename = page.getByRole("textbox", {
    name: "Dictionary name",
    exact: true,
  });
  await expect(rename).toBeFocused();
  await rename.fill("Context dictionary");
  await rename.press("Enter");
  const card = page
    .locator(".dictionary-cards .voice-card")
    .filter({ hasText: "Context dictionary" });
  await card.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Deactivate", exact: true }).click();
  await expect(card.getByRole("checkbox")).not.toBeChecked();
  await card.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const dialog = page.locator(".pronunciation-dialog");
  await expect(dialog).toBeVisible();
  const input = dialog
    .locator('input[type="text"], input:not([type]), textarea')
    .first();
  await input.fill("Selection test");
  await input.press("ControlOrMeta+A");
  await input.click({ button: "right" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Copy", exact: true }).click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    "Selection test",
  );
  await page
    .getByRole("button", { name: "Close Dictionary Editor", exact: true })
    .click();
  const voice = page.locator(".voice-manager .voice-card").first();
  await voice.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Voice name", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");

  await editor.fill("A page of text to arrange.\n".repeat(80));
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  const cards = page.locator(".page-card");
  await expect(cards.first()).toBeVisible();
  for (const scale of [0.5, 1, 1.5]) {
    await page.evaluate(
      (scale) =>
        document.documentElement.style.setProperty("--ui-scale", String(scale)),
      scale,
    );
    await cards.first().click({ button: "right", position: { x: 8, y: 8 } });
    await expect(menu).toBeVisible();
    expect(
      await menu.evaluate((el) => {
        const s = getComputedStyle(el),
          b = getComputedStyle(el.querySelector("button"));
        return [
          s.borderRadius,
          s.backgroundColor,
          s.borderTopColor,
          b.padding,
          b.minHeight,
        ];
      }),
    ).toEqual(style);
    const box = await menu.boundingBox();
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press("Escape");
  }
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--ui-scale", "1"),
  );
  await cards.first().click({ button: "right", position: { x: 8, y: 8 } });
  await menu.getByRole("menuitem", { name: "Focus page", exact: true }).click();
  await expect(page.locator(".arrangement-page-focus")).toBeVisible();
  await page.keyboard.press("Escape");
  await cards.first().click({ button: "right", position: { x: 8, y: 8 } });
  await menu
    .getByRole("menuitem", { name: "Arrange with...", exact: true })
    .click();
  await cards.nth(1).click({ position: { x: 8, y: 8 } });
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  const back = page.getByRole("button", {
    name: "Back to Arrangement",
    exact: true,
  });
  await expect(back).toBeVisible();
  await expect(back).toHaveCSS("text-transform", "none");
  await back.click();
  expect(errors).toEqual([]);
  console.log(
    "Context menu desktop checks passed: editor clipboard/history, dialog fields, dictionary actions, voice rename, shared styling, keyboard dismissal and UI scaling.",
  );
} finally {
  await app.close();
}
