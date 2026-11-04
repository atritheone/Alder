import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/document-combination-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-combination-"));
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
  const sources = await page.evaluate(async (fixtures) => {
    const result = [];
    for (const fixture of fixtures) {
      const p = await window.alder.request("POST", "/api/projects", {
        name: fixture.name,
        template: "blank",
      });
      p.book = fixture.book;
      p.styles = fixture.styles;
      p.settings = fixture.settings;
      result.push(
        await window.alder.request("PUT", `/api/projects/${p.id}`, {
          project: p,
          expectedRevision: p.revision,
        }),
      );
    }
    return result;
  }, fixtures);
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Alice review" })
    .first()
    .click();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    dialog = page.getByRole("dialog", {
      name: "Combine reviewed copies",
      exact: true,
    });
  await expect(editor).toContainText("Alice");
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Combine reviewed copies…", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Second reviewed copy", { exact: true })
    .selectOption(sources[1].id);
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Create reviewed copy", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByLabel("Conflict at paragraph 3", { exact: true }),
  ).toContainText("Alice review");
  await dialog
    .getByLabel("Keep review at paragraph 3", { exact: true })
    .selectOption("revised");
  await expect(
    dialog.getByRole("button", { name: "Create reviewed copy", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: path.join(directory, "combine.png") });
  await dialog
    .getByRole("button", { name: "Create reviewed copy", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(editor.locator("[data-revision-block-move]")).toHaveCount(2);
  for (const source of sources)
    expect(
      (
        await page.evaluate(
          (id) => window.alder.request("GET", `/api/projects/${id}`),
          source.id,
        )
      ).book,
    ).toEqual(source.book);
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Review changes…", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Review changes",
    exact: true,
  });
  await expect(review.locator(".review-list>button")).toHaveCount(4);
  await expect(review.locator(".review-list")).toContainText("Alice");
  await expect(review.locator(".review-list")).toContainText("Bob");
  await review
    .getByLabel("Review preview", { exact: true })
    .selectOption("final");
  await expect(
    review.getByLabel("final document preview", { exact: true }),
  ).toHaveText(
    "First Alice paragraph.Bob wording.Last Bob paragraph.Moved paragraph.",
  );
  await review.getByLabel("Review scope", { exact: true }).selectOption("all");
  await review.getByRole("button", { name: "Reject", exact: true }).click();
  await review.getByRole("button", { name: "Done", exact: true }).click();
  await expect(editor).toHaveText(
    "Moved paragraph.First paragraph.Disputed wording.Last paragraph.",
  );
  await editor.press("Control+z");
  await expect(editor.locator("[data-revision-block-move]")).toHaveCount(2);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Alice review - combined review" })
    .first()
    .click();
  await expect(editor.locator("[data-revision-block-move]")).toHaveCount(2);
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
