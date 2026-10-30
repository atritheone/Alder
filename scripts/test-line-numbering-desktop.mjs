import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/line-number-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-line-numbers-"));
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
    fs.readFileSync("work/line-numbers-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Line numbering desktop",
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
      .filter({ hasText: "Line numbering desktop" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    sheets = page.locator(".page-sheets > .page-sheet");
  await expect(sheets).toHaveCount(2);
  const labels = () =>
    sheets.evaluateAll((nodes) =>
      nodes.map((node) =>
        [...node.querySelectorAll(".page-line-numbers text")].map((text) =>
          Number(text.textContent),
        ),
      ),
    );
  await expect.poll(labels).toEqual([[4, 6, 8], [10]]);
  report.initial = await labels();
  const text = await editor.innerText();
  await editor.getByText("BRAVO", { exact: false }).click();
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Paragraph…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Paragraph", exact: true });
  await dialog
    .getByLabel("Suppress line numbers", { exact: true })
    .selectOption("true");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(labels).toEqual([[4], [6]]);
  await editor.focus();
  await page.keyboard.press("Control+z");
  await expect.poll(labels).toEqual([[4, 6, 8], [10]]);
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("tab", { name: "Page Layout", exact: true }).click();
  await settings
    .getByLabel("Line numbering", { exact: true })
    .selectOption("newPage");
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(labels).toEqual([[4, 6, 8], [4]]);
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
    await expect(sheets).toHaveCount(2);
    await expect.poll(labels).toEqual([[4, 6, 8], [4]]);
  }
  await page.getByLabel("Page zoom", { exact: true }).selectOption("1");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect.poll(labels).toEqual([[4, 6, 8], [4]]);
  expect(await editor.innerText()).toBe(text);
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card .page-line-numbers text")).toHaveCount(
    4,
  );
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
  expect(pdf.result.validation.pages).toBe(2);
  fs.writeFileSync(
    path.join(directory, "numbered.pdf"),
    Buffer.from(pdf.bytes),
  );
  for (const [name, expected] of [
    [
      "all",
      [
        [3, 4, 5, 6, 7, 8, 9],
        [10, 11],
      ],
    ],
    ["sections", [[3, 4, 10, 11], [10, 11], []]],
  ]) {
    const source = JSON.parse(
      fs.readFileSync(
        `work/line-numbers-word-${name}/fixture-project.json`,
        "utf8",
      ),
    );
    await page.evaluate(
      async ({ id, source }) => {
        const p = await window.alder.request("GET", `/api/projects/${id}`);
        p.book = source.book;
        p.settings = { ...p.settings, ...source.settings };
        await window.alder.request("PUT", `/api/projects/${id}`, {
          project: p,
          expectedRevision: p.revision,
        });
      },
      { id, source },
    );
    await reopen();
    await expect.poll(labels).toEqual(expected);
    const pdf = await page.evaluate(async (id) => {
      const r = await window.alder.request(
        "POST",
        `/api/projects/${id}/export`,
        { format: "pdf" },
      );
      return [
        ...new Uint8Array(
          await (
            await fetch(window.alder.mediaBase + r.downloadUrl)
          ).arrayBuffer(),
        ),
      ];
    }, id);
    fs.writeFileSync(
      path.join(directory, `numbered-${name}.pdf`),
      Buffer.from(pdf),
    );
  }
  expect(report.errors).toEqual([]);
  report.status = "passed";
  report.checks.push(
    "Native Word line labels, empty lines/table exclusion, paragraph suppression/undo, per-page restart, UI scales/zoom, save/reopen, Arrangement and PDF",
  );
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
