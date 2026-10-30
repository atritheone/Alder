import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/watermark-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-watermark-"));
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
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const fixture = JSON.parse(
    fs.readFileSync("work/watermark-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Watermark desktop",
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
      .filter({ hasText: "Watermark desktop" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    sheets = page.locator(".page-sheets > .page-sheet");
  await expect(sheets).toHaveCount(6);
  const labels = () =>
    sheets.evaluateAll((nodes) =>
      nodes.map(
        (node) => node.querySelector(".page-watermark text")?.textContent || "",
      ),
    );
  await expect
    .poll(labels)
    .toEqual(["DRAFT", "DRAFT", "PRIVATE", "PRIVATE", "", ""]);
  const text = await editor.innerText();
  expect(text).not.toContain("DRAFT");
  expect(text).not.toContain("PRIVATE");
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("tab", { name: "Page Layout", exact: true }).click();
  await settings
    .getByLabel("Watermark text", { exact: true })
    .fill("WORKING COPY");
  await settings.getByLabel("Watermark text", { exact: true }).press("Enter");
  await settings
    .getByLabel("Watermark angle (degrees)", { exact: true })
    .fill("0");
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect
    .poll(labels)
    .toEqual(["WORKING COPY", "WORKING COPY", "PRIVATE", "PRIVATE", "", ""]);
  const transform = () =>
    sheets.first().locator(".page-watermark > g").getAttribute("transform");
  await expect.poll(transform).toContain("rotate(0)");
  await editor.focus();
  await page.keyboard.press("Control+z");
  await expect.poll(transform).toContain("rotate(315)");
  await page.keyboard.press("Control+y");
  await expect.poll(transform).toContain("rotate(0)");
  for (const [scale, zoom] of [
    [0.5, 0.5],
    [1, 1],
    [1.5, 3],
  ]) {
    await page.keyboard.press("Control+,");
    await settings
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await settings
      .getByLabel("UI Scale", { exact: true })
      .selectOption(String(scale));
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    expect(
      await page.evaluate(() =>
        Number(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--ui-scale",
          ),
        ),
      ),
    ).toBe(scale);
    await page
      .getByLabel("Page zoom", { exact: true })
      .selectOption(String(zoom));
    await expect(sheets).toHaveCount(6);
    await expect
      .poll(labels)
      .toEqual(["WORKING COPY", "WORKING COPY", "PRIVATE", "PRIVATE", "", ""]);
    const geometry = await sheets.first().evaluate((sheet) => {
      const mark = sheet
          .querySelector(".page-watermark text")
          .getBoundingClientRect(),
        page = sheet.getBoundingClientRect();
      return {
        centerX: (mark.left + mark.right) / 2 - (page.left + page.right) / 2,
        centerY: (mark.top + mark.bottom) / 2 - (page.top + page.bottom) / 2,
      };
    });
    expect(Math.abs(geometry.centerX)).toBeLessThan(2);
    report[`scale-${scale}`] = geometry;
    await page.keyboard.press("Control+,");
    await settings
      .getByRole("tab", { name: "Page Layout", exact: true })
      .click();
    await settings
      .getByLabel("Watermark angle (degrees)", { exact: true })
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
    .poll(labels)
    .toEqual(["WORKING COPY", "WORKING COPY", "PRIVATE", "PRIVATE", "", ""]);
  expect(await editor.innerText()).toBe(text);
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(6);
  await expect(page.locator(".page-card .page-watermark text")).toHaveCount(4);
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
  expect(pdf.result.validation.pages).toBe(6);
  fs.writeFileSync(
    path.join(directory, "watermarks.pdf"),
    Buffer.from(pdf.bytes),
  );
  expect(report.errors).toEqual([]);
  report.checks.push(
    "Section watermarks, controls, undo/redo, save/reopen, native body unchanged, UI scales, Write zoom, Arrangement and PDF",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await page
    ?.screenshot({ path: path.join(directory, "failure.png"), timeout: 5000 })
    .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
