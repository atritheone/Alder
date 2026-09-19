import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-start-size-"));
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "New", exact: true }).waitFor();
  const size = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getContentSize(),
    );
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
  expect(Math.abs((await size())[0] - 590)).toBeLessThanOrEqual(3);
  expect(Math.abs((await size())[1] - 460)).toBeLessThanOrEqual(3);
  await page.getByRole("button", { name: "New", exact: true }).click();
  const form = page.getByRole("dialog", { name: "New document" });
  let rect = await form.boundingBox();
  expect((await size())[0] - rect.width).toBeGreaterThanOrEqual(150);
  expect((await size())[1] - rect.height).toBeGreaterThanOrEqual(150);
  await page.getByRole("button", { name: "Book Chapters & pages" }).click();
  await expect.poll(async () => (await size())[1]).toBeGreaterThan(700);
  rect = await form.boundingBox();
  expect((await size())[1] - rect.height).toBeGreaterThanOrEqual(150);
  await expect(
    page.getByRole("button", { name: "Create", exact: true }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Text document .txt" }).click();
  await expect.poll(async () => (await size())[1]).toBeLessThanOrEqual(463);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Chapter text editor", exact: true })
    .waitFor();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
  console.log(
    JSON.stringify({
      ok: true,
      start: [590, 460],
      padding: 80,
      bookExpands: true,
      workspaceMaximises: true,
    }),
  );
} finally {
  await app.close();
}
