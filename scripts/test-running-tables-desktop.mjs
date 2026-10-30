import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/running-tables"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-running-tables-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", checks: [], errors: [] };
let app, page;
const stage = (value) => {
  report.stage = value;
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
};
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.show();
    w.focus();
    w.setSize(1400, 1000);
  });
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve("work/running-tables-word/fixture-project.json"),
      "utf8",
    ),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      template: "blank",
      name: "Running tables",
    });
    p.settings = fixture.settings;
    p.book = fixture.book;
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
      .filter({ hasText: "Running tables" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    sheets = page.locator(".page-sheets > .page-sheet"),
    dialog = page.getByRole("dialog", {
      name: "Headers and footers",
      exact: true,
    }),
    story = page.getByRole("textbox", {
      name: "Header text editor",
      exact: true,
    });
  const menu = async () => {
    await editor.press("Control+Home");
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Headers and footers…", exact: true })
      .click();
  };
  stage("initial header tables");
  await expect(sheets).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await expect(
      sheets.nth(i).locator("[data-running-story=header] table"),
    ).toHaveCount(1);
    await expect(sheets.nth(i)).toContainText(`Page ${i + 1}`);
  }
  await expect(editor).not.toContainText("HEADER COMPANY");
  stage("native cell editing and history");
  await menu();
  await story.locator("td").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.type("EDITED ");
  await page.keyboard.press("Tab");
  await page.keyboard.type("NEXT ");
  await expect(story.locator("td").nth(1)).toContainText("NEXT");
  await dialog
    .getByLabel("Header/footer table")
    .selectOption("Insert row below");
  await expect(story.locator("tr")).toHaveCount(3);
  await story.press("Control+z");
  await expect(story.locator("tr")).toHaveCount(2);
  await story.locator("td").first().click();
  await dialog.getByLabel("Header/footer table").selectOption("Split cell");
  await expect(story.locator("td")).toHaveCount(4);
  await story.press("Control+z");
  await expect(story.locator("td")).toHaveCount(3);
  await dialog.getByLabel("Header/footer table").selectOption("properties");
  const properties = page.getByRole("dialog", {
    name: "Table properties",
    exact: true,
  });
  await properties.getByLabel("Table alignment").selectOption("left");
  await properties.getByRole("button", { name: "Apply", exact: true }).click();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sheets.first()).toContainText("EDITED");
  await editor.press("Control+z");
  await expect(sheets.first()).not.toContainText("EDITED");
  await editor.press("Control+y");
  await expect(sheets.first()).toContainText("EDITED");
  report.checks.push(
    "Native cell typing, Tab navigation, row insertion, split merged cell, properties and story/project undo.",
  );
  stage("insert table and cancel");
  await menu();
  await story.press("Control+End");
  await dialog.getByLabel("Header/footer table").selectOption("insert");
  const insert = page.getByRole("dialog", {
    name: "Insert table",
    exact: true,
  });
  await insert.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(story.locator("table")).toHaveCount(2);
  await story.press("Control+z");
  await expect(story.locator("table")).toHaveCount(1);
  await dialog.press("Escape");
  await expect(dialog).toHaveCount(0);
  stage("persistence and PDF");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(sheets.first()).toContainText("EDITED");
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
  fs.writeFileSync(
    path.join(directory, "running-tables.pdf"),
    Buffer.from(pdf.bytes),
  );
  expect(pdf.result.validation.status).toBe("passed");
  expect(pdf.result.validation.pages).toBe(2);
  await page.screenshot({ path: path.join(directory, "write.png") });
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(2);
  await expect(
    page.locator(".page-card").last().locator("[data-running-story=header]"),
  ).toContainText("Page 2");
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  for (const scale of ["0.5", "1", "1.5"]) {
    await page.evaluate(
      (scale) => localStorage.setItem("alder.uiScale", scale),
      scale,
    );
    await reopen();
    await expect(sheets).toHaveCount(2);
    await menu();
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  report.checks.push(
    "Insertion/undo/cancel, saved reopening, live page fields, Arrangement, desktop PDF and 50/100/150% UI scales.",
  );
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
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
