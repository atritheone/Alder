import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/page-border-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-page-border-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", checks: [], errors: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const fixture = JSON.parse(
    fs.readFileSync("work/page-border-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Page border desktop",
      template: "blank",
    });
    p.book = fixture.book;
    p.settings = { ...p.settings, ...fixture.settings };
    await window.alder.request("PUT", `/api/projects/${p.id}`, {
      project: p,
      expectedRevision: p.revision,
    });
    return p.id;
  }, fixture);
  const reopen = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: "Page border desktop" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    sheets = page.locator(".page-sheets > .page-sheet");
  await expect(sheets).toHaveCount(10);
  const rectangles = () =>
    sheets.evaluateAll((nodes) =>
      nodes.map((node) =>
        [...node.querySelectorAll(".page-border rect")].map((rect) => ({
          x: Number(rect.getAttribute("x")),
          y: Number(rect.getAttribute("y")),
          stroke: rect.getAttribute("stroke"),
          width: Number(rect.getAttribute("stroke-width")),
        })),
      ),
    );
  const expected = [1, 1, 2, 0, 0, 1, 1, 1, 0, 0];
  await expect
    .poll(async () => (await rectangles()).map((r) => r.length))
    .toEqual(expected);
  report.menus=await app.evaluate(({Menu})=>Menu.getApplicationMenu()?.items.map(m=>({label:m.label,items:m.submenu?.items.map(i=>i.label)})));
  const openSettings = () => page.keyboard.press('Control+,');
  await openSettings();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("tab", { name: "Page Layout", exact: true }).click();
  await settings
    .getByLabel("Page border", { exact: true })
    .selectOption("double");
  await settings
    .getByLabel("Page border width (pt)", { exact: true })
    .fill("2");
  await settings
    .getByLabel("Border distance from page edge (pt)", { exact: true })
    .fill("20");
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(async () => (await rectangles())[0].length).toBe(2);
  expect((await rectangles())[0]?.[0]?.x ?? -1).toBeCloseTo(28, 6);
  expect((await rectangles())[0][1].x).toBeCloseTo(100 / 3, 6);
  // One settings change per undo step; undo restores only the distance.
  await editor.focus();
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await rectangles())[0]?.[0]?.x ?? -1)
    .toBeCloseTo(100 / 3, 6);
  await page.keyboard.press("Control+y");
  await expect
    .poll(async () => (await rectangles())[0]?.[0]?.x ?? -1)
    .toBeCloseTo(28, 6);
  for (const [scale, zoom] of [
    [0.5, 0.5],
    [1, 1],
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
    await expect
      .poll(() =>
        page.evaluate(() =>
          Number(
            getComputedStyle(document.documentElement).getPropertyValue(
              "--ui-scale",
            ),
          ),
        ),
      )
      .toBe(scale);
    await page
      .getByLabel("Page zoom", { exact: true })
      .selectOption(String(zoom));
    await expect(sheets).toHaveCount(10);
    expect((await rectangles())[0]?.[0]?.x ?? -1).toBeCloseTo(28, 6);
    await openSettings();
    await settings
      .getByRole("tab", { name: "Page Layout", exact: true })
      .click();
    await settings
      .getByLabel("Show page border on", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(directory, `settings-${scale}.png`),
    });
    await settings.getByRole("button", { name: "Done", exact: true }).click();
  }
  await page.getByLabel("Page zoom", { exact: true }).selectOption("1");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect
    .poll(async () => (await rectangles())[0]?.[0]?.x ?? -1)
    .toBeCloseTo(28, 6);
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(10);
  await expect(
    page.locator(".page-card").first().locator(".page-border rect"),
  ).toHaveCount(2);
  await page.screenshot({ path: path.join(directory, "arrangement.png") });
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  const pdf = await page.evaluate(async (id) => {
    const result = await window.alder.request(
      "POST",
      `/api/projects/${id}/export`,
      { format: "pdf" },
    );
    return {
      result,
      bytes: [
        ...new Uint8Array(
          await (
            await fetch(window.alder.mediaBase + result.downloadUrl)
          ).arrayBuffer(),
        ),
      ],
    };
  }, id);
  expect(pdf.result.validation.pages).toBe(10);
  fs.writeFileSync(
    path.join(directory, "page-borders.pdf"),
    Buffer.from(pdf.bytes),
  );
  report.checks.push(
    "Section-specific first/all/except-first and disabled borders, real Settings edits, undo/redo, persistence, Arrangement and 10-page PDF",
    "UI scales 50/100/150% and Write zoom through 300% keep border geometry and page count",
  );
  report.geometry = await rectangles();
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  await page
    ?.screenshot({ path: path.join(directory, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
