import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/book-structure-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-book-structure-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", errors: [], checks: [] };
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
  const fixture = JSON.parse(
    fs.readFileSync("work/book-structure-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Book structure desktop",
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
      .filter({ hasText: "Book structure desktop" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    outline = page.getByRole("navigation", { name: "Book chapters" });
  await outline
    .getByRole("button", { name: "Open chapter The story", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Chapter properties", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Chapter properties",
    exact: true,
  });
  await dialog
    .getByLabel("Chapter type", { exact: true })
    .selectOption("introduction");
  await dialog
    .getByLabel("Book division", { exact: true })
    .selectOption("frontmatter");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(editor).toContainText("BODY_2");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await editor.click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  let p = await page.evaluate(
    async (id) => window.alder.request("GET", `/api/projects/${id}`),
    id,
  );
  expect(p.book.chapters[2].role).toBe("chapter");
  await outline
    .getByRole("button", { name: "Add chapter", exact: true })
    .first()
    .click();
  dialog = page.getByRole("dialog", { name: "Add chapter", exact: true });
  await dialog
    .getByLabel("Chapter type", { exact: true })
    .selectOption("preface");
  await expect(dialog.getByLabel("Chapter name", { exact: true })).toHaveValue(
    "Preface",
  );
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await editor.click();
  await page.keyboard.type("NEW_PREFACE authored content.");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  p = await page.evaluate(
    async (id) => window.alder.request("GET", `/api/projects/${id}`),
    id,
  );
  expect(p.book.chapters.map((c) => c.title)).toEqual([
    "The title",
    "Opening words",
    "Preface",
    "The story",
    "Extra material",
  ]);
  expect(p.book.chapters[2].text).toBe("NEW_PREFACE authored content.");
  report.checks.push(
    "Chapter properties, undo, structured insertion and authored content remain independent",
  );
  await reopen();
  await outline
    .getByRole("button", { name: "Open chapter The title", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Chapter properties", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Chapter properties",
    exact: true,
  });
  await expect(
    dialog.getByLabel("Show title in publication"),
  ).not.toBeChecked();
  for (const scale of [0.5, 1, 1.5]) {
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.keyboard.press('Control+,');
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
      .getByRole("button", { name: "Chapter properties", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Apply", exact: true }),
    ).toBeInViewport();
  }
  await page.screenshot({
    path: path.join(directory, "chapter-properties.png"),
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
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
  fs.writeFileSync(path.join(directory, "book.pdf"), Buffer.from(pdf.bytes));
  report.pages = pdf.result.validation.pages;
  expect(report.pages).toBe(5);
  report.checks.push(
    "Save/reopen, title visibility, UI scales 50/100/150% and five-page desktop PDF",
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
