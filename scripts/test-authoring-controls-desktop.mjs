import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import { closeTestDesktop } from "./close-test-desktop.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-word-processing-"));
const report = path.join(data, "authoring-report.json");
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
    // Legacy helpers and activation events must not make a test visible.
    w.show();
    w.showInactive();
    w.focus();
    w.maximize();
    w.restore();
    w.webContents.openDevTools();
    w.webContents.toggleDevTools();
  });
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.isVisible()),
    ),
  ).toBe(false);
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.webContents.isDevToolsOpened()))).toBe(false);
  expect(
    await app.evaluate(async ({ dialog }) => {
      try {
        await dialog.showOpenDialog({ title: "Unexpected test dialog" });
        return false;
      } catch (error) {
        return String(error).includes("Hidden test requested");
      }
    }),
  ).toBe(true);
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
  const hwnd = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]
      .getNativeWindowHandle()
      .readBigUInt64LE()
      .toString(),
  );
  const { execFileSync } = await import("node:child_process");
  const probe = (...args) =>
    execFileSync("python", ["scripts/windows-menu-probe.py", hwnd, ...args], {
      encoding: "utf8",
    });
  const nativeItem = (label) => {
    const find = (items) => {
      for (const item of items) {
        if (item.label.replaceAll("&", "") === label) return item;
        const child = find(item.children || []);
        if (child) return child;
      }
    };
    return find(JSON.parse(probe("inspect")).menu);
  };
  const native = (label) => {
    const item = nativeItem(label);
    if (!item) throw new Error("Missing command: " + label);
    probe("command", String(item.id));
  };
  await editor.fill("Authoring selection.");
  await editor.press("ControlOrMeta+a");
  native("Bold");
  await expect(editor.locator("strong")).toHaveText("Authoring selection.");
  await expect.poll(() => nativeItem("Bold")?.state & 8).toBe(8);
  await editor.press("ControlOrMeta+z");
  await editor.press("Home");
  await editor.press("ControlOrMeta+Shift+ArrowRight");
  native("Bold");
  await editor.press("ControlOrMeta+a");
  await expect.poll(() => !!nativeItem("Bold (Mixed)")).toBe(true);
  await editor.press("ControlOrMeta+z");
  await editor.press("ControlOrMeta+a");
  native("Copy Formatting");
  await expect
    .poll(() =>
      nativeItem("Paste Formatting") == null
        ? -1
        : nativeItem("Paste Formatting").state & 3,
    )
    .toBe(0);
  native("Find Command…");
  const search = page.getByRole("dialog", {
    name: "Find command",
    exact: true,
  });
  await expect(search).toBeVisible();
  await search.getByRole("searchbox").fill("insert table");
  await search.getByRole("searchbox").press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Insert table", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Insert table", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("Authoring selection.");
  const ruler = page.getByLabel("Paragraph ruler in mm", { exact: true });
  await expect(ruler).toBeVisible();
  await ruler.getByLabel("New tab alignment").selectOption("decimal");
  const rect = await ruler.locator(".ruler-track").boundingBox();
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height - 4);
  await expect(ruler.locator(".ruler-tab-decimal")).toHaveCount(1);
  const tab = await ruler.locator(".ruler-tab-decimal").boundingBox();
  await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
  await page.mouse.down();
  await page.mouse.move(tab.x, rect.y + rect.height + 30);
  await page.mouse.up();
  await expect(ruler.locator(".ruler-tab")).toHaveCount(0);
  await editor.press("ControlOrMeta+z");
  await expect(ruler.locator(".ruler-tab-decimal")).toHaveCount(1);
  native("Vertical");
  const topMargin = page.getByRole("button", {
    name: "Top page margin: 22 mm",
    exact: true,
  });
  await expect(topMargin).toBeVisible();
  await topMargin.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("button", {
      name: "Top page margin: 22.35 mm",
      exact: true,
    }),
  ).toBeVisible();
  await editor.press("ControlOrMeta+z");
  await expect(topMargin).toBeVisible();
  native("Page Setup…");
  const setup = page.getByRole("dialog", { name: "Page setup", exact: true });
  await expect(setup).toBeVisible();
  await setup
    .getByLabel("Apply page settings to", { exact: true })
    .selectOption("document");
  await setup.getByLabel("Top margin (mm)", { exact: true }).fill("1in");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Top page margin: 25.4 mm", exact: true }),
  ).toBeVisible();
  await editor.press("ControlOrMeta+z");
  await expect(topMargin).toBeVisible();
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.isVisible()),
    ),
  ).toBe(false);
  const originalTab = await ruler
    .locator(".ruler-tab-decimal")
    .getAttribute("aria-label");
  native("Paragraph…");
  const paragraph = page.getByRole("dialog", {
    name: "Paragraph",
    exact: true,
  });
  await paragraph
    .getByLabel("Default tab spacing (mm)", { exact: true })
    .fill("24pt");
  await paragraph
    .getByLabel("Tab 1 position (mm)", { exact: true })
    .fill("96pt");
  await paragraph.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(() =>
      editor.evaluate((e) =>
        Number(getComputedStyle(e).getPropertyValue("--alder-default-tab")),
      ),
    )
    .toBe(24);
  await expect(ruler.locator(".ruler-tab-decimal")).toHaveAttribute(
    "aria-label",
    "decimal tab at 33.87 mm",
  );
  await editor.press("ControlOrMeta+z");
  await expect
    .poll(() =>
      editor.evaluate((e) =>
        Number(getComputedStyle(e).getPropertyValue("--alder-default-tab")),
      ),
    )
    .toBe(36);
  await expect(ruler.locator(".ruler-tab-decimal")).toHaveAttribute(
    "aria-label",
    originalTab,
  );
  await editor.press("ControlOrMeta+Shift+p");
  await search.getByRole("searchbox").fill("paragraph");
  await search.getByRole("searchbox").press("Enter");
  await paragraph
    .getByLabel("Default tab spacing (mm)", { exact: true })
    .fill("48pt");
  await paragraph
    .getByLabel("Tab 1 alignment", { exact: true })
    .selectOption("decimal");
  await paragraph.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(() =>
      editor.evaluate((e) =>
        Number(getComputedStyle(e).getPropertyValue("--alder-default-tab")),
      ),
    )
    .toBe(48);
  await editor.press("ControlOrMeta+z");
  await expect
    .poll(() =>
      editor.evaluate((e) =>
        Number(getComputedStyle(e).getPropertyValue("--alder-default-tab")),
      ),
    )
    .toBe(36);
  await editor.press("ControlOrMeta+Shift+p");
  await expect(search).toBeVisible();
  await search.getByRole("searchbox").fill("hanging");
  await expect(
    search.getByRole("button", { name: /Paragraph…$/ }).first(),
  ).toBeVisible();
  await search.getByRole("button", { name: "Close", exact: true }).click();
  const zoom = page.getByLabel("Page zoom", { exact: true });
  await zoom.selectOption("page");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const page = document
          .querySelector(".book-main .page-sheet")
          .getBoundingClientRect();
        const viewport = document
          .querySelector(".book-main .editor-scroll")
          .getBoundingClientRect();
        return page.height < viewport.height && page.width < viewport.width;
      }),
    )
    .toBe(true);
  await zoom.selectOption("width");
  const beforeWidth = await page
    .locator(".book-main .page-sheet")
    .first()
    .evaluate((e) => e.getBoundingClientRect().width);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1050, 800),
  );
  await expect
    .poll(() =>
      page
        .locator(".book-main .page-sheet")
        .first()
        .evaluate((e) => e.getBoundingClientRect().width),
    )
    .toBeLessThan(beforeWidth);
  expect(
    await page.evaluate(() => localStorage.getItem("alder.writeFit")),
  ).toBe("width");
  await zoom.selectOption("1");
  expect(
    await page.evaluate(() => localStorage.getItem("alder.writeFit")),
  ).toBe("percentage");
  await editor.focus();
  native("Headers And Footers…");
  const running = page.getByRole("dialog", {
    name: "Headers and footers",
    exact: true,
  });
  await running.getByLabel("Different first page", { exact: true }).check();
  await running
    .getByLabel("Header/footer page variant", { exact: true })
    .selectOption("first");
  await running
    .getByRole("textbox", { name: "Header text editor", exact: true })
    .fill("First-page heading");
  await running
    .getByLabel("Header/footer distance (mm)", { exact: true })
    .fill("8");
  await running.getByRole("button", { name: "Apply", exact: true }).click();
  const headerDistance = page.getByRole("button", {
    name: "Header distance: 8 mm",
    exact: true,
  });
  await expect(headerDistance).toBeVisible();
  await headerDistance.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("button", { name: "Header distance: 8.35 mm", exact: true }),
  ).toBeVisible();
  await editor.press("ControlOrMeta+z");
  await expect(headerDistance).toBeVisible();
  await headerDistance.focus();
  await headerDistance.dblclick();
  await expect(
    running.getByLabel("Header/footer page variant", { exact: true }),
  ).toHaveValue("first");
  await running.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.focus();
  native("Page Setup…");
  await setup.getByLabel("Columns", { exact: true }).selectOption("2");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  const columnEdge = page.getByRole("button", {
    name: "Column gap 1 right edge",
    exact: true,
  });
  await expect(columnEdge).toBeVisible();
  await expect(columnEdge).toHaveAttribute("title", /^Gap: 8 mm\./);
  await columnEdge.focus();
  await page.keyboard.press("ArrowRight");
  await expect(columnEdge).toHaveAttribute("title", /^Gap: 8.71 mm\./);
  await editor.press("ControlOrMeta+z");
  await expect(columnEdge).toHaveAttribute("title", /^Gap: 8 mm\./);
  const edge = await columnEdge.boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + 30, edge.y + edge.height / 2);
  await expect(page.locator(".ruler-drag-guide")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(columnEdge).toHaveAttribute("title", /^Gap: 8 mm\./);
  await expect(page.locator(".ruler-drag-guide")).toHaveCount(0);
  // A table has its own physical grid controls, not paragraph indent markers.
  await editor.focus();
  native("Page Setup…");
  await setup.getByLabel("Columns", { exact: true }).selectOption("1");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await editor.press("ControlOrMeta+End");
  native("Insert Table…");
  const insertTable = page.getByRole("dialog", {
    name: "Insert table",
    exact: true,
  });
  await insertTable.getByLabel("Table rows").fill("2");
  await insertTable.getByLabel("Table columns").fill("2");
  await insertTable
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  const cells = editor.locator("td");
  await cells.first().click();
  await page.keyboard.type("First cell");
  const boundary = page.getByRole("button", {
    name: "Table column boundary 2",
    exact: true,
  });
  await expect(boundary).toBeVisible();
  const widths = () =>
    editor
      .locator("colgroup col")
      .evaluateAll((cols) =>
        cols.map(
          (c) => parseFloat(c.style.width) || c.getBoundingClientRect().width,
        ),
      );
  const beforeTable = await widths();
  await boundary.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => Math.abs((await widths())[0] - beforeTable[0] - 4 / 3))
    .toBeLessThan(0.02);
  await expect(boundary).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => Math.abs((await widths())[0] - beforeTable[0] - 8 / 3))
    .toBeLessThan(0.04);
  await editor.press("ControlOrMeta+z");
  expect((await widths()).reduce((a, b) => a + b, 0)).toBeCloseTo(
    beforeTable.reduce((a, b) => a + b, 0),
    1,
  );
  await editor.press("ControlOrMeta+z");
  await expect.poll(widths).toEqual(beforeTable);
  const rowHeight = page.getByRole("button", {
    name: "Selected row minimum height",
    exact: true,
  });
  await expect(rowHeight).toBeVisible();
  await rowHeight.focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(editor.locator("tr").first()).toHaveAttribute(
    "style",
    /height:/,
  );
  await editor.press("ControlOrMeta+z");
  await boundary.focus();
  const boundaryBox = await boundary.boundingBox();
  await page.mouse.move(boundaryBox.x + 4, boundaryBox.y + 4);
  await page.mouse.down();
  await page.mouse.move(boundaryBox.x + 32, boundaryBox.y + 4);
  await expect(page.locator(".ruler-drag-guide")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(widths).toEqual(beforeTable);
  await expect(page.locator(".ruler-drag-guide")).toHaveCount(0);
  await boundary.dblclick();
  const tableProperties = page.getByRole("dialog", {
    name: "Table properties",
    exact: true,
  });
  await expect(
    tableProperties.getByLabel("Minimum row height (mm)", { exact: true }),
  ).toBeVisible();
  await tableProperties
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.isVisible()),
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  console.log(
    "PASS: native search, selection, tabs, page scope, margin/header/column/table rulers, variants, fit views and undo; all windows remained hidden",
  );
} catch (error) {
  console.error(error);
  await page
    ?.screenshot({ path: path.join(data, "failure.png") })
    .catch(() => {});
  console.error("Hidden fixture:", data);
  process.exitCode = 1;
} finally {
  await closeTestDesktop(app, `${data}/data`);
}
