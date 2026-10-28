import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-page-geometry-"));
const checks = [];
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1440, 1000);
    win.show();
    win.focus();
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
  await editor.fill(
    Array.from(
      { length: 60 },
      (_, i) => `GEOMETRY${i} The branches moved gently in the wind.`,
    ).join("\n"),
  );
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const openSettings = () =>
    app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()
        .items.flatMap((menu) => menu.submenu?.items || [])
        .find((item) => item.label === "Settings…");
      Reflect.apply(item.click, item, [
        { triggeredByAccelerator: false },
        BrowserWindow.getAllWindows()[0],
        {},
      ]);
    });
  await openSettings();
  await settings.getByRole("tab", { name: "Page Layout", exact: true }).click();
  await settings
    .getByLabel("Page size", { exact: true })
    .selectOption("Custom");
  for (const [label, value] of [
    ["Paper width", 180],
    ["Paper height", 240],
    ["Top", 10],
    ["Bottom", 17],
    ["Left", 19],
    ["Right", 15],
    ["Left binding gutter", 6],
  ]) {
    const input = settings.getByLabel(`${label} (mm)`, { exact: true });
    await input.fill(String(value));
    await input.press("Tab");
  }
  await page.screenshot({ path: "work/page-geometry-settings.png" });
  // Reject a valid numeric entry whose combination would leave no writing area.
  await settings.getByLabel("Left (mm)", { exact: true }).fill("100");
  await settings.getByLabel("Right (mm)", { exact: true }).fill("100");
  await expect(settings.getByRole("alert")).toContainText("20 mm");
  await settings.getByLabel("Right (mm)", { exact: true }).press("Tab");
  await expect(settings.getByLabel("Right (mm)", { exact: true })).toHaveValue(
    "15",
  );
  await settings.getByLabel("Left (mm)", { exact: true }).fill("19");
  await settings
    .getByLabel("Running header", { exact: true })
    .fill("RUNNING_HEADER");
  await settings.getByLabel("Page numbers in footer", { exact: true }).check();
  await settings
    .getByLabel("Start page numbering at", { exact: true })
    .fill("7");
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  const measure = () =>
    editor.evaluate((element) => {
      const canvas = element.closest(".flow-canvas").getBoundingClientRect();
      const body = element.getBoundingClientRect();
      const scale = canvas.width / ((180 * 96) / 25.4);
      const mm = (value) => ((value / scale) * 25.4) / 96;
      return {
        left: mm(body.left - canvas.left),
        top: mm(body.top - canvas.top),
        width: mm(body.width),
        height:
          (parseFloat(
            getComputedStyle(element.closest(".flow-canvas")).getPropertyValue(
              "--page-height",
            ),
          ) *
            25.4) /
          96,
      };
    });
  await expect(
    page.locator(".page-sheet").first().locator(".page-furniture"),
  ).toHaveText("RUNNING_HEADER7");
  await expect(editor).not.toContainText("RUNNING_HEADER");
  for (const [scale, zoom] of [
    [1, 1],
    [0.5, 0.5],
    [1.5, 3],
  ]) {
    await openSettings();
    await settings
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await settings
      .getByLabel("UI Scale", { exact: true })
      .selectOption(String(scale));
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await page
      .getByLabel("Page zoom", { exact: true })
      .selectOption(String(zoom));
    await expect
      .poll(async () => Math.abs((await measure()).left - 25))
      .toBeLessThan(0.06);
    const geometry = await measure();
    const overflow = await editor.evaluate((element) => {
      const scroll = element.closest(".editor-scroll");
      const display = element.closest(".flow-display");
      const style = getComputedStyle(scroll);
      return {
        actual: scroll.scrollHeight,
        expected: Math.max(
          scroll.clientHeight,
          display.offsetHeight +
            parseFloat(style.paddingTop) +
            parseFloat(style.paddingBottom),
        ),
      };
    });
    expect(
      overflow.actual - overflow.expected,
      "zoom out must not leave blank scroll pages",
    ).toBeLessThan(3);
    expect(geometry.top).toBeCloseTo(10, 1);
    expect(geometry.width).toBeCloseTo(140, 1);
    expect(geometry.height).toBeCloseTo(240, 1);
    const target = editor.locator("p").nth(40);
    await target.click({ position: { x: 12, y: 6 } });
    await page.keyboard.press("Home");
    await page.keyboard.insertText("CARET_OK ");
    await expect(target).toContainText("CARET_OK GEOMETRY40");
    await editor.press("ControlOrMeta+z");
    await expect(target).not.toContainText("CARET_OK");
    checks.push({ scale, zoom, geometry });
  }
  await openSettings();
  await settings.getByLabel("UI Scale", { exact: true }).selectOption("1");
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByLabel("Page zoom", { exact: true }).selectOption("1");
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  const snapshot = page.locator(".page-snapshot").first();
  await expect(snapshot).toBeVisible();
  await expect(snapshot.locator(".page-furniture")).toHaveText(
    "RUNNING_HEADER7",
  );
  const arranged = await snapshot.evaluate((element) => {
    const outer = element.getBoundingClientRect();
    const first = element
      .querySelector(".ProseMirror > *")
      .getBoundingClientRect();
    const scale = outer.width / ((180 * 96) / 25.4);
    return {
      left: (((first.left - outer.left) / scale) * 25.4) / 96,
      top: (((first.top - outer.top) / scale) * 25.4) / 96,
    };
  });
  expect(arranged.left).toBeCloseTo(25, 1);
  expect(arranged.top).toBeCloseTo(10, 1);
  checks.push({ arrangement: arranged });
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await editor.evaluate((element) => {
    element.closest(".editor-scroll").scrollTop = 0;
  });
  await page.screenshot({ path: "work/page-furniture.png" });
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: "Untitled", exact: false }).click();
  await expect.poll(async () => Math.round((await measure()).left)).toBe(25);
  checks.push("page geometry survives reopening");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.evaluate(async () => {
    const id = localStorage.getItem("alder.project");
    const project = await window.alder.request("GET", `/api/projects/${id}`);
    for (const key of [
      "pageWidthMm",
      "pageHeightMm",
      "marginTopMm",
      "marginRightMm",
      "marginBottomMm",
      "marginLeftMm",
      "gutterMm",
    ])
      delete project.settings[key];
    Object.assign(project.settings, {
      pageSize: "A5",
      orientation: "portrait",
      marginMm: 100,
    });
    project.book.chapters[0].document = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Legacy margins" }],
        },
      ],
    };
    await window.alder.request("PUT", `/api/projects/${id}`, {
      expectedRevision: project.revision,
      project,
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: "Untitled", exact: false }).click();
  await expect(editor).toContainText("Legacy margins");
  await openSettings();
  await settings.getByRole("tab", { name: "Page Layout", exact: true }).click();
  await settings.getByLabel("Left (mm)", { exact: true }).fill("20");
  await settings.getByLabel("Left (mm)", { exact: true }).press("Tab");
  await expect(settings.getByLabel("Right (mm)", { exact: true })).toHaveValue(
    "64",
  );
  await expect(settings.getByLabel("Top (mm)", { exact: true })).toHaveValue(
    "95",
  );
  await expect(settings.getByRole("alert")).toHaveCount(0);
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  checks.push(
    "legacy impossible margins can be repaired in one ordinary edit without changing the other effective margins",
  );
  expect(errors).toEqual([]);
  fs.writeFileSync(
    "work/page-geometry-report.json",
    JSON.stringify({ status: "passed", checks, errors }, null, 2),
  );
} catch (error) {
  await page
    ?.screenshot({ path: "work/page-geometry-failure.png" })
    .catch(() => {});
  fs.writeFileSync(
    "work/page-geometry-report.json",
    JSON.stringify({ status: "failed", checks, error: error.stack }, null, 2),
  );
  throw error;
} finally {
  await app?.close();
}
