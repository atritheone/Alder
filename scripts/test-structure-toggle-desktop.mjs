import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Exercise the real native menu update as well as the editable document. A
// screenshot after the click misses the transient menu removal/client resize.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-structure-"));
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await editor.fill(
    Array.from(
      { length: 65 },
      (_, i) =>
        `Paragraph ${i + 1} has spaces and enough writing to fill several pages.`,
    ).join("\n"),
  );
  await editor.press("ControlOrMeta+End");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const toggle = page
    .locator(".book-main .format-toolbar")
    .getByRole("button", { name: "Show structure", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    globalThis.structureGeometry = {
      before: w.getContentBounds(),
      sizes: [],
      detached: 0,
    };
    const original = w.setMenu;
    w.setMenu = function (menu) {
      if (menu === null) globalThis.structureGeometry.detached++;
      return original.call(this, menu);
    };
    if (process.platform === "win32")
      w.hookWindowMessage(0x5, () => {
        globalThis.structureGeometry.sizes.push(w.getContentBounds());
      });
  });
  const before = await editor.evaluate((element) => {
    const scroll = element.closest(".editor-scroll");
    window.structureEditor = element;
    return {
      text: element.textContent,
      top: scroll.scrollTop,
      pages: scroll.querySelectorAll(".page-sheet").length,
    };
  });
  for (let index = 0; index < 6; index++) {
    const visible = index % 2 !== 0;
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", String(visible));
    await expect
      .poll(() =>
        app.evaluate(({ Menu }) => {
          const view = Menu.getApplicationMenu().items.find(
            (item) => item.label === "View",
          );
          return view.submenu.items.some(
            (item) => item.label === "Hide Structure",
          );
        }),
      )
      .toBe(visible);
    expect(await editor.locator(".structure-marker").count()).toBe(65);
    expect(
      await editor
        .locator(".structure-marker")
        .first()
        .evaluate((element) => getComputedStyle(element, "::after").visibility),
    ).toBe(visible ? "visible" : "hidden");
    const after = await editor.evaluate((element) => {
      const scroll = element.closest(".editor-scroll");
      return {
        same: window.structureEditor === element,
        text: element.textContent,
        top: scroll.scrollTop,
        pages: scroll.querySelectorAll(".page-sheet").length,
      };
    });
    expect(after).toEqual({ same: true, ...before });
  }
  const geometry = await app.evaluate(() => globalThis.structureGeometry);
  expect(geometry.detached).toBe(0);
  for (const size of geometry.sizes) expect(size).toEqual(geometry.before);
  // Toggling is a view operation and must not consume an undo step.
  await editor.focus();
  await editor.pressSequentially(" Undo probe");
  await editor.press("ControlOrMeta+z");
  await expect(editor).toHaveText(before.text);
  await page.keyboard.press("Control+,");
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({ status: "passed", toggles: 6, geometry, errors }),
  );
} finally {
  const timer = setTimeout(() => app.process().kill(), 10000);
  try {
    await app.close();
  } finally {
    clearTimeout(timer);
  }
}
