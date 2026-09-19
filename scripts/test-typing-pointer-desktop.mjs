import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-typing-pointer-"));
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1280, 900);
    w.showInactive();
  });
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const hidden = () =>
    page.evaluate(() =>
      document.documentElement.classList.contains("alder-typing-pointer"),
    );
  const write = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await write.click();
  await page.keyboard.type("Writing hides the mouse.");
  expect(await hidden()).toBe(true);
  await expect(write).toHaveCSS("cursor", "none");
  await page.mouse.move(5, 5);
  expect(await hidden()).toBe(false);
  await page.keyboard.press("Backspace");
  expect(await hidden()).toBe(true);
  await page
    .getByRole("button", { name: "Toggle sandbox", exact: true })
    .click();
  expect(await hidden()).toBe(false);
  const sandbox = page.getByRole("textbox", {
    name: "Sandbox text editor",
    exact: true,
  });
  await sandbox.click();
  await page.keyboard.type("Sandbox input.");
  expect(await hidden()).toBe(true);
  await expect(sandbox).toHaveCSS("cursor", "none");
  await page.keyboard.press("Tab");
  expect(await hidden()).toBe(false);
  await sandbox.focus();
  await sandbox.dispatchEvent("compositionstart");
  expect(await hidden()).toBe(true);
  await page.mouse.move(10, 10);
  expect(await hidden()).toBe(false);
  console.log(
    JSON.stringify({
      ok: true,
      write: true,
      sandbox: true,
      composition: true,
      movementRestores: true,
      focusRestores: true,
    }),
  );
} finally {
  await app.close();
}
