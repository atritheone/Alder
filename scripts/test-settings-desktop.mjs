import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-settings-"));
let app;
const errors = [];
async function launch() {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1280, 900);
    w.showInactive();
  });
  return page;
}
async function menu(group, label) {
  expect(
    await app.evaluate(
      ({ Menu, BrowserWindow }, { group, label }) => {
        const item = Menu.getApplicationMenu()
          ?.items.find((item) => item.label === group)
          ?.submenu?.items.find((item) => item.label === label);
        if (!item) return false;
        item.click(item, BrowserWindow.getAllWindows()[0]);
        return true;
      },
      { group, label },
    ),
  ).toBe(true);
}
try {
  let page = await launch();
  await page.getByRole("button", { name: "New", exact: true }).waitFor();
  await menu("Edit", "Settings…");
  let dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Page Layout", exact: true }).click();
  await expect(dialog.getByLabel("Page size", { exact: true })).toBeDisabled();
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await dialog.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Chapter text editor", exact: true })
    .waitFor();
  await menu("Edit", "Settings…");
  await dialog.getByRole("tab", { name: "Writing", exact: true }).click();
  await dialog.getByLabel("Check writing", { exact: true }).uncheck();
  await dialog.getByLabel("Check sandbox", { exact: true }).uncheck();
  const bodySize = dialog.getByLabel("Body size (pt)", { exact: true });
  await bodySize.fill("");
  await bodySize.pressSequentially("14");
  await expect(bodySize).toHaveValue("14");
  await dialog.getByRole("tab", { name: "Page Layout", exact: true }).click();
  await dialog.getByLabel("Page size", { exact: true }).selectOption("A5");
  await dialog
    .getByLabel("Orientation", { exact: true })
    .selectOption("landscape");
  await dialog.getByLabel("Start page numbering at", { exact: true }).fill("7");
  await dialog.getByRole("tab", { name: "Publication", exact: true }).click();
  await dialog.getByLabel("Author", { exact: true }).fill("Settings Test");
  await dialog.getByLabel("Include glossary", { exact: true }).check();
  await dialog.getByRole("tab", { name: "Speech", exact: true }).click();
  await dialog.getByLabel("Write speed", { exact: true }).fill("1.35");
  await dialog.getByLabel("Sandbox speed", { exact: true }).fill("1.2");
  await dialog.getByLabel("Narration speed", { exact: true }).fill("0.85");
  await dialog.getByLabel("Write volume", { exact: true }).fill("1.5");
  await dialog
    .getByLabel("Narration format", { exact: true })
    .selectOption("mp3");
  await dialog
    .getByLabel("Narration boundary pause", { exact: true })
    .fill("0.3");
  await dialog
    .getByLabel("Strict wording verification", { exact: true })
    .check();
  await dialog
    .getByRole("tab", { name: "Language Rules", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "New rule", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await dialog.screenshot({ path: "work/settings-appearance.png" });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(900, 680),
  );
  for (const scale of ["0.5", "1.5", "1"]) {
    await dialog.getByLabel("UI Scale", { exact: true }).selectOption(scale);
    const bounds = await dialog.boundingBox();
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    await expect(
      dialog.getByRole("button", { name: "Done", exact: true }),
    ).toBeVisible();
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 900),
  );
  await dialog.getByRole("tab", { name: "Speech", exact: true }).click();
  await dialog.screenshot({ path: "work/settings-speech.png" });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const write = page.locator(".document-reader:not(.sandbox-reader)");
  await expect(write.locator('input[type="number"]')).toHaveValue("1.35");
  await expect(write.getByRole("slider", { name: /volume/i })).toHaveValue(
    "1.5",
  );
  const checks = page.getByRole("button", {
    name: "Spelling and grammar",
    exact: true,
  });
  for (const check of await checks.all())
    await expect(check).toHaveAttribute("aria-pressed", "false");
  await checks.first().click();
  await menu("Edit", "Settings…");
  await dialog.getByRole("tab", { name: "Writing", exact: true }).click();
  await expect(
    dialog.getByLabel("Check writing", { exact: true }),
  ).toBeChecked();
  // Vertical tabs are keyboard navigable; focus remains trapped by the native dialog.
  await dialog.getByRole("tab", { name: "Writing", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    dialog.getByRole("tab", { name: "Page Layout", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await app.close();
  app = null;
  page = await launch();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator(".project-list-item").first().click();
  await page
    .getByRole("textbox", { name: "Chapter text editor", exact: true })
    .waitFor();
  await menu("Edit", "Settings…");
  dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("tab", { name: "Writing", exact: true }).click();
  await expect(
    dialog.getByLabel("Body size (pt)", { exact: true }),
  ).toHaveValue("14");
  await expect(
    dialog.getByLabel("Check sandbox", { exact: true }),
  ).not.toBeChecked();
  await dialog.getByRole("tab", { name: "Page Layout", exact: true }).click();
  await expect(dialog.getByLabel("Page size", { exact: true })).toHaveValue(
    "A5",
  );
  await expect(
    dialog.getByLabel("Start page numbering at", { exact: true }),
  ).toHaveValue("7");
  await dialog.getByRole("tab", { name: "Publication", exact: true }).click();
  await expect(dialog.getByLabel("Author", { exact: true })).toHaveValue(
    "Settings Test",
  );
  await expect(
    dialog.getByLabel("Include glossary", { exact: true }),
  ).toBeChecked();
  await dialog.getByRole("tab", { name: "Speech", exact: true }).click();
  await expect(dialog.getByLabel("Write speed", { exact: true })).toHaveValue(
    "1.35",
  );
  await expect(dialog.getByLabel("Sandbox speed", { exact: true })).toHaveValue(
    "1.2",
  );
  await expect(
    dialog.getByLabel("Narration speed", { exact: true }),
  ).toHaveValue("0.85");
  await expect(dialog.getByLabel("Write volume", { exact: true })).toHaveValue(
    "1.5",
  );
  await expect(
    dialog.getByLabel("Narration format", { exact: true }),
  ).toHaveValue("mp3");
  await expect(
    dialog.getByLabel("Narration boundary pause", { exact: true }),
  ).toHaveValue("0.3");
  await expect(
    dialog.getByLabel("Strict wording verification", { exact: true }),
  ).toBeChecked();
  await dialog
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      ok: true,
      menu: true,
      persistence: true,
      liveControls: true,
      scales: [50, 100, 150],
      screenshots: ["work/settings-appearance.png", "work/settings-speech.png"],
    }),
  );
} finally {
  if (app) await app.close();
}
