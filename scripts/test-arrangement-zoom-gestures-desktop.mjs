import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-zoom-gesture-"));
const report = "work/zoom-gesture-report.json";
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.getByRole("button", { name: "New", exact: true }).waitFor();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await editor.fill(
    Array.from(
      { length: 100 },
      (_, i) => `Paragraph ${i}. Another sentence here.`,
    ).join("\n\n"),
  );
  await page.getByRole("tab", { name: "Write", exact: true }).focus();
  await page.keyboard.press("Tab");
  const area = page.locator(".page-arranger");
  const cards = page.locator(".page-card");
  await expect.poll(() => cards.count()).toBeGreaterThan(2);
  // Dispatch at controlled targets: a layout gesture stays a layout gesture
  // when its next event lands on a page.
  const width = () =>
    cards
      .first()
      .locator(".page-miniature")
      .evaluate((el) => el.getBoundingClientRect().width);
  const wheel = async (locator, deltaY) =>
    locator.dispatchEvent("wheel", { deltaY, bubbles: true, cancelable: true });
  await wheel(area, -120);
  await wheel(cards.first(), -120);
  await expect(page.locator(".arrangement-page-focus")).toHaveCount(0);
  await page.waitForTimeout(450);
  const before = await width();
  await wheel(cards.first(), -120);
  const overlay = page.locator(".arrangement-page-focus");
  await expect(overlay).toBeVisible();
  // End page focus and continue the same gesture over the background.
  await wheel(overlay, 1440);
  await expect(overlay).toHaveCount(0);
  await wheel(area, 120);
  expect(await width()).toBe(before);
  await page.waitForTimeout(450);
  await wheel(area, 120);
  await expect.poll(width).toBeLessThan(before);
  // Zooming out over an unfocused page must not change layout zoom.
  await page.waitForTimeout(450);
  const after = await width();
  await wheel(cards.first(), 120);
  expect(await width()).toBe(after);
  await expect(overlay).toHaveCount(0);
  fs.writeFileSync(
    report,
    JSON.stringify({
      status: "passed",
      checks:
        "Layout-to-page gesture lock, page-to-layout gesture lock, fresh gesture after idle, page zoom lower boundary",
    }),
  );
} catch (error) {
  fs.writeFileSync(
    report,
    JSON.stringify({ status: "failed", error: error.stack }),
  );
  throw error;
} finally {
  await app.close();
}
