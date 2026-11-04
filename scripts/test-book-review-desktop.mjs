import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/book-review-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-book-review-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", errors: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const fixtures = JSON.parse(
    fs.readFileSync("work/combination-word/fixture-inputs.json", "utf8"),
  );
  const initial = await page.evaluate(async (fixtures) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Review book",
      template: "blank",
    });
    p.book = {
      version: 1,
      chapters: fixtures.map((f, i) => ({
        ...f.book.chapters[0],
        id: `chapter_${i}`,
        title: i ? "Second review" : "First review",
        include: i === 0,
      })),
    };
    p.styles = fixtures[0].styles;
    p.settings = { ...fixtures[0].settings, documentKind: "book" };
    return window.alder.request("PUT", `/api/projects/${p.id}`, {
      project: p,
      expectedRevision: p.revision,
    });
  }, fixtures);
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Review book" })
    .first()
    .click();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    dialog = page.getByRole("dialog", { name: "Review changes", exact: true });
  await expect(editor).toContainText("Alice");
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  const open = async () => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Review changes…", exact: true })
      .click();
    await expect(dialog).toBeVisible();
  };
  await open();
  await dialog
    .getByLabel("Review coverage", { exact: true })
    .selectOption("book");
  await expect(dialog.locator(".review-list>button")).toHaveCount(5);
  await dialog
    .getByLabel("Review author filter", { exact: true })
    .selectOption("Bob");
  await expect(dialog.locator(".review-list>button")).toHaveCount(2);
  await expect(
    dialog.getByLabel("markup document preview", { exact: true }),
  ).toContainText("Bob");
  await page.screenshot({ path: path.join(directory, "book-review.png") });
  await dialog
    .getByRole("button", { name: "Go to change", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(editor).toContainText("Bob");
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString() || ""))
    .toContain("Bob");
  await open();
  await dialog
    .getByLabel("Review coverage", { exact: true })
    .selectOption("book");
  await dialog.getByLabel("Review scope", { exact: true }).selectOption("all");
  await dialog.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const saved = await page.evaluate(
    (id) => window.alder.request("GET", `/api/projects/${id}`),
    initial.id,
  );
  for (const c of saved.book.chapters)
    expect(c.text).toBe(
      "Moved paragraph.\nFirst paragraph.\nDisputed wording.\nLast paragraph.",
    );
  await editor.press("Control+z");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const undone = await page.evaluate(
    (id) => window.alder.request("GET", `/api/projects/${id}`),
    initial.id,
  );
  expect(undone.book).toEqual(initial.book);
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Review book" })
    .first()
    .click();
  await open();
  await dialog
    .getByLabel("Review coverage", { exact: true })
    .selectOption("book");
  await expect(dialog.locator(".review-list>button")).toHaveCount(5);
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.error = error.stack;
  if (page)
    await page
      .screenshot({ path: path.join(directory, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  if (app) await app.close();
}
