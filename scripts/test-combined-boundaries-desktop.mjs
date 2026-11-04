import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const expect = baseExpect.configure({ timeout: 20000 }),
  directory = path.resolve("work/combined-boundaries-ui"),
  profile = fs.mkdtempSync(
    path.join(os.tmpdir(), "alder-combined-boundaries-"),
  );
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
    fs.readFileSync(
      "work/combined-boundaries-word/fixture-inputs.json",
      "utf8",
    ),
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
  const open = async (name) => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: name })
      .first()
      .click();
  };
  await open("Alice boundaries");
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const menu = async (name) => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  await menu("Combine reviewed copies…");
  const dialog = page.getByRole("dialog", {
    name: "Combine reviewed copies",
    exact: true,
  });
  await dialog
    .getByLabel("Second reviewed copy", { exact: true })
    .selectOption(sources[1].id);
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Create reviewed copy", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Keep review at paragraph 2", { exact: true })
    .selectOption("revised");
  await dialog
    .getByRole("button", { name: "Create reviewed copy", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const breaks = editor.locator("[data-revision-break]");
  await expect(breaks).toHaveCount(2);
  await menu("Review changes…");
  const review = page.getByRole("dialog", {
    name: "Review changes",
    exact: true,
  });
  await expect(review.locator(".review-list>button")).toHaveCount(3);
  await review
    .getByLabel("Review preview", { exact: true })
    .selectOption("original");
  await expect(
    review.getByLabel("original document preview", { exact: true }),
  ).toHaveText(
    "Opening words continue.Disputed wording.Joined first.Joined second.",
  );
  await review
    .getByLabel("Review preview", { exact: true })
    .selectOption("final");
  await expect(
    review.getByLabel("final document preview", { exact: true }),
  ).toHaveText(
    "Opening words continue.Bob wording.Joined first.Joined second.",
  );
  await page.screenshot({ path: path.join(directory, "review.png") });
  await review
    .getByLabel("Review author filter", { exact: true })
    .selectOption("Alice");
  await review
    .getByLabel("Review scope", { exact: true })
    .selectOption("author");
  await review.getByRole("button", { name: "Reject", exact: true }).click();
  await review.getByRole("button", { name: "Done", exact: true }).click();
  await expect(breaks).toHaveCount(1);
  await expect(editor.locator('[data-revision-break="deletion"]')).toHaveCount(
    1,
  );
  await editor.press("Control+z");
  await expect(breaks).toHaveCount(2);
  await menu("Review changes…");
  await review
    .getByLabel("Review author filter", { exact: true })
    .selectOption("");
  await review.getByLabel("Review scope", { exact: true }).selectOption("all");
  await review.getByRole("button", { name: "Reject", exact: true }).click();
  await review.getByRole("button", { name: "Done", exact: true }).click();
  await expect(breaks).toHaveCount(0);
  await expect(editor.locator(":scope > p")).toHaveCount(4);
  await expect(editor).toHaveText(
    "Opening words continue.Disputed wording.Joined first.Joined second.",
  );
  await editor.press("Control+z");
  await expect(breaks).toHaveCount(2);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await open("Alice boundaries - combined review");
  await expect(breaks).toHaveCount(2);
  for (const scale of [0.5, 1, 1.5]) {
    await page.keyboard.press("Control+,");
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await settings
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await settings
      .getByLabel("UI Scale", { exact: true })
      .selectOption(String(scale));
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await expect(breaks).toHaveCount(2);
  }
  for (const source of sources)
    expect(
      (
        await page.evaluate(
          (id) => window.alder.request("GET", `/api/projects/${id}`),
          source.id,
        )
      ).book,
    ).toEqual(source.book);
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
