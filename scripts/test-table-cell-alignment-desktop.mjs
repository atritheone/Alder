import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/table-cell-alignment-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-cell-alignment-"));
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
    fs.readFileSync(
      "work/table-align-word-middle/fixture-project.json",
      "utf8",
    ),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Cell alignment desktop",
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
      .filter({ hasText: "Cell alignment desktop" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    sheets = page.locator(".page-sheets > .page-sheet");
  await expect(sheets).toHaveCount(4);
  const geometry = () =>
    editor.evaluate((root) => {
      const first = [...root.querySelectorAll("p")].find(
          (p) => p.textContent === "LONG000",
        ),
        short = [...root.querySelectorAll("p")].find(
          (p) => p.textContent === "SHORT000",
        ),
        last = [...root.querySelectorAll("p")].find(
          (p) => p.textContent === "SHORT003",
        );
      const scale = root.getBoundingClientRect().width / root.offsetWidth;
      return {
        first: first.getBoundingClientRect().top,
        short: short.getBoundingClientRect().top,
        last: last.getBoundingClientRect().top,
        scale,
        shortTransform: short.style.transform,
      };
    });
  let g = await geometry();
  report.middle = g;
  expect((g.short - g.first) / g.scale).toBeCloseTo(144, 0);
  await editor.getByText("SHORT000", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.type("EDITED ");
  await expect(editor).toContainText("EDITED SHORT000");
  await page.keyboard.press("Control+z");
  await expect(editor).not.toContainText("EDITED");
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Table properties…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Table properties",
    exact: true,
  });
  await expect(
    dialog.getByLabel("Cell vertical alignment", { exact: true }),
  ).toHaveValue("middle");
  await dialog
    .getByLabel("Cell vertical alignment", { exact: true })
    .selectOption("bottom");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(async () => {
      g = await geometry();
      return (g.short - g.first) / g.scale;
    })
    .toBeCloseTo(288, 0);
  report.bottom = await geometry();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(sheets).toHaveCount(4);
  g = await geometry();
  expect((g.short - g.first) / g.scale).toBeCloseTo(288, 0);
  await page.screenshot({ path: path.join(directory, "bottom.png") });
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(4);
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
  expect(pdf.result.validation.pages).toBe(4);
  fs.writeFileSync(path.join(directory, "bottom.pdf"), Buffer.from(pdf.bytes));
  report.checks.push(
    "Spanning row middle/bottom offsets match native Word, real caret typing/undo, properties, save/reopen, Arrangement and shared PDF",
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
