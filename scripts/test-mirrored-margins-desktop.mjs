import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/mirrored-margins"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-mirrored-ui-"));
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
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1440, 1000);
    win.show();
    win.focus();
  });
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const id = await page.evaluate(async () => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Mirrored margins",
      template: "blank",
    });
    Object.assign(p.settings, {
      documentKind: "docx",
      includeTitle: false,
      footer: true,
      pageSize: "Custom",
      pageWidthMm: 150,
      pageHeightMm: 170,
      marginTopMm: 20,
      marginBottomMm: 20,
      marginLeftMm: 40,
      marginRightMm: 20,
      gutterMm: 5,
      mirrorMargins: false,
      firstPageNumber: 2,
      header: "MIRRORED_HEADER",
    });
    p.book = {
      version: 1,
      chapters: [
        {
          id: "c",
          title: "Text",
          include: true,
          document: {
            type: "doc",
            content: Array.from({ length: 4 }, (_, i) => ({
              type: "paragraph",
              attrs: { pageBreakBefore: i > 0 },
              content: [
                {
                  type: "text",
                  text: `MIRROR${i + 1} Inside and outside margins.`,
                },
              ],
            })),
          },
        },
      ],
    };
    await window.alder.request("PUT", `/api/projects/${p.id}`, {
      project: p,
      expectedRevision: p.revision,
    });
    return p.id;
  });
  const reopen = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: "Mirrored margins" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    sheets = page.locator(".page-sheets > .page-sheet");
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
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("tab", { name: "Page Layout", exact: true }).click();
  await settings.getByLabel("Mirror margins", { exact: true }).check();
  await expect(settings.getByLabel("Inside (mm)", { exact: true })).toHaveValue(
    "40",
  );
  await expect(
    settings.getByLabel("Outside (mm)", { exact: true }),
  ).toHaveValue("20");
  await expect(
    settings.getByLabel("Inside binding gutter (mm)", { exact: true }),
  ).toHaveValue("5");
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  const geometry = () =>
    editor.locator(":scope > p").evaluateAll((nodes) => {
      const canvas = nodes[0].closest(".flow-canvas"),
        scale = canvas.getBoundingClientRect().width / ((150 * 96) / 25.4),
        sheets = [...document.querySelectorAll(".page-sheets > .page-sheet")];
      return nodes.map((node, i) => ({
        label: node.textContent,
        x:
          (((node.getBoundingClientRect().left -
            sheets[i].getBoundingClientRect().left) /
            scale) *
            25.4) /
          96,
      }));
    });
  await expect(sheets).toHaveCount(4);
  await expect
    .poll(async () => Math.abs((await geometry())[0].x - 20))
    .toBeLessThan(0.05);
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
    const points = await geometry();
    points.forEach((point, index) =>
      expect(point.x).toBeCloseTo(index % 2 ? 45 : 20, 1),
    );
    report.checks.push({ scale, zoom, points });
  }
  await page.getByLabel("Page zoom", { exact: true }).selectOption("1");
  await editor.locator("p").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.type("EDITED ");
  await expect(editor).toContainText("EDITED MIRROR1");
  await editor.press("Control+z");
  await expect(editor).not.toContainText("EDITED");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(sheets).toHaveCount(4);
  expect((await geometry())[0].x).toBeCloseTo(20, 1);
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(4);
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
  expect(pdf.result.validation.pages).toBe(4);
  fs.writeFileSync(
    path.join(directory, "mirrored.pdf"),
    Buffer.from(pdf.bytes),
  );
  await openSettings();
  await settings.getByRole("tab", { name: "Page Layout", exact: true }).click();
  await settings.getByLabel("Mirror margins", { exact: true }).uncheck();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect
    .poll(async () => Math.abs((await geometry())[0].x - 45))
    .toBeLessThan(0.05);
  report.checks.push(
    "Settings apply/disable, saved/reopened, actual typing/undo, Arrangement and PDF",
  );
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
