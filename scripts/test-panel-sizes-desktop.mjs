import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-panel-sizes-"));
let app;
const launch = async () => {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1280, 900);
    window.showInactive();
  });
  page.setDefaultTimeout(15000);
  return page;
};
const newDocument = async (page) => {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Chapter text editor", exact: true })
    .waitFor();
  await expect(page.locator(".save-status")).toHaveText("Saved");
};
const dimensions = (page) =>
  page.evaluate(() => ({
    sandbox: parseFloat(
      document
        .querySelector(".alder-app")
        .style.getPropertyValue("--detail-height"),
    ),
    browser: parseFloat(
      document
        .querySelector(".alder-app")
        .style.getPropertyValue("--browser-width"),
    ),
    collections: +document
      .querySelector('[aria-label="Resize Collections And Content"]')
      .getAttribute("aria-valuenow"),
    filters: +document
      .querySelector('[aria-label="Resize Filters And Content"]')
      .getAttribute("aria-valuenow"),
    words: +document
      .querySelector('[aria-label="Resize Sandbox Word Panel"]')
      .getAttribute("aria-valuenow"),
  }));
const drag = async (page, target, dx, dy) => {
  await target.hover(); // Wait for font loading/pagination to settle the divider.
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + dx,
    box.y + box.height / 2 + dy,
    { steps: 5 },
  );
  await page.mouse.up();
};
try {
  let page = await launch();
  await newDocument(page);
  expect(
    await page.evaluate(() => localStorage.getItem("alder.bookSandboxHeight")),
  ).toBe("287.5");
  await page
    .getByRole("button", { name: "Toggle Left Panel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle sandbox", exact: true })
    .click();
  await page
    .locator(".detail-heading")
    .getByRole("tab", { name: "Sandbox", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Sandbox text editor", exact: true })
    .waitFor();
  await drag(
    page,
    page.getByRole("separator", { name: "Resize Left Panel", exact: true }),
    50,
    0,
  );
  await drag(page, page.locator(".horizontal-resizer"), 0, -60);
  await page
    .getByRole("separator", {
      name: "Resize Collections And Content",
      exact: true,
    })
    .press("ArrowRight");
  await page
    .getByRole("separator", { name: "Resize Filters And Content", exact: true })
    .press("ArrowDown");
  await page
    .getByRole("separator", { name: "Resize Sandbox Word Panel", exact: true })
    .press("ArrowLeft");
  const resized = await dimensions(page);
  expect(resized.sandbox).toBeCloseTo(347.5, 0);
  expect(resized.browser).toBeCloseTo(392, 0);
  expect(resized.collections).toBe(160);
  expect(resized.filters).toBe(165);
  expect(resized.words).toBe(264);
  // Hiding/reopening panels also remounts the library's internal dividers.
  for (const name of ["Toggle Left Panel", "Toggle sandbox"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name, exact: true }).click();
  }
  expect(await dimensions(page)).toEqual(resized);
  await app.close();
  app = null;
  page = await launch();
  await newDocument(page);
  expect(await dimensions(page)).toEqual(resized);
  // Dimensions remain logical pixels when UI scale changes.
  await page.evaluate(() => localStorage.setItem("alder.uiScale", "0.8"));
  await page.reload();
  await newDocument(page);
  expect(await dimensions(page)).toEqual(resized);
  await drag(page, page.locator(".horizontal-resizer"), 0, -40);
  const scaled = await dimensions(page);
  expect(scaled.sandbox).toBeCloseTo(resized.sandbox + 50, 0);
  await page.reload();
  await newDocument(page);
  expect(await dimensions(page)).toEqual(scaled);
  // Recover the size saved by the old mismatched preference names.
  await page.evaluate(() => {
    localStorage.setItem("alder.detailHeight", "418");
    localStorage.setItem("alder.bookSandboxHeight", "230");
  });
  await page.reload();
  await newDocument(page);
  expect((await dimensions(page)).sandbox).toBe(418);
  expect(
    await page.evaluate(() => localStorage.getItem("alder.detailHeight")),
  ).toBeNull();
  // An old automatically saved default gets the 25% increase.
  await page.evaluate(() => {
    localStorage.setItem("alder.detailHeight", "230");
    localStorage.removeItem("alder.bookSandboxHeight");
  });
  await page.reload();
  await newDocument(page);
  expect((await dimensions(page)).sandbox).toBe(287.5);
  // A deliberately saved 230px size in the corrected key stays exactly 230px.
  await page.evaluate(() =>
    localStorage.setItem("alder.bookSandboxHeight", "230"),
  );
  await page.reload();
  await newDocument(page);
  expect((await dimensions(page)).sandbox).toBe(230);
  console.log(
    "Panel size checks passed: all five dividers, full app restart, hide/show, UI scale, legacy size recovery, and 25% larger default.",
    resized,
  );
} finally {
  if (app) await app.close();
}
