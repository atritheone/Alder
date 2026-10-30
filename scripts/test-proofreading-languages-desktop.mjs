import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const expect = baseExpect.configure({ timeout: 45000 }),
  directory = path.resolve("work/proofreading-languages-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-languages-"));
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
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const id = await page.evaluate(async () => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Multilingual proofreading",
      template: "blank",
    });
    const para = (text, attrs = {}) => ({
      type: "paragraph",
      attrs,
      content: [{ type: "text", text }],
    });
    p.settings.documentKind = "docx";
    p.settings.includeTitle = false;
    p.styles.push({
      id: "fr",
      name: "French prose",
      kind: "paragraph",
      textLanguage: "fr",
    });
    p.book = {
      version: 1,
      chapters: [
        {
          id: "text",
          title: "Text",
          include: true,
          document: {
            type: "doc",
            content: [
              para("The colour is blue.", { textLanguage: "en-GB" }),
              para("The colour is blue.", { textLanguage: "en-US" }),
              para("Bonjour le monde.", { styleId: "fr" }),
              para("Ceci est une fautte.", { textLanguage: "fr" }),
              para("This is mispelled."),
            ],
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
      .filter({ hasText: "Multilingual proofreading" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    paragraphs = editor.locator("p"),
    status = page.getByRole("button", {
      name: "Open spelling and grammar",
      exact: true,
    });
  await expect(paragraphs.nth(4).locator(".annotation-spelling")).toContainText(
    "mispelled",
  );
  await expect(paragraphs.nth(0).locator(".annotation-spelling")).toHaveCount(
    0,
  );
  await expect(paragraphs.nth(1).locator(".annotation-spelling")).toContainText(
    "colour",
  );
  await expect(paragraphs.nth(2).locator(".annotation-spelling")).toHaveCount(
    0,
  );
  await expect(paragraphs.nth(3).locator(".annotation-spelling")).toContainText(
    "fautte",
  );
  const wording = await editor.innerText();
  await paragraphs.nth(2).click();
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Paragraph…", exact: true }).click();
  const paragraph = page.getByRole("dialog", {
    name: "Paragraph",
    exact: true,
  });
  await paragraph.getByText("Language and direction", { exact: true }).click();
  await paragraph
    .getByLabel("Paragraph language", { exact: true })
    .fill("en-GB");
  await paragraph.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    paragraphs.nth(2).locator(".annotation-spelling").first(),
  ).toBeVisible();
  expect(await editor.innerText()).toBe(wording);
  await editor.focus();
  await page.keyboard.press("Control+z");
  await expect(paragraphs.nth(4).locator(".annotation-spelling")).toContainText(
    "mispelled",
  );
  await expect(paragraphs.nth(2).locator(".annotation-spelling")).toHaveCount(
    0,
  );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(paragraphs.nth(3).locator(".annotation-spelling")).toContainText(
    "fautte",
  );
  await expect(paragraphs.nth(2).locator(".annotation-spelling")).toHaveCount(
    0,
  );
  await status.click();
  const panel = page.getByRole("dialog", {
    name: "Spelling and Grammar",
    exact: true,
  });
  await panel.getByRole("button", { name: "Use “faute”", exact: true }).click();
  await expect(paragraphs.nth(3)).toHaveText("Ceci est une faute.");
  await expect(paragraphs.nth(1)).toHaveText("The colour is blue.");
  await panel
    .getByRole("button", { name: "Close spelling and grammar", exact: true })
    .click();
  await editor.focus();
  await page.keyboard.press("Control+z");
  await expect(paragraphs.nth(3)).toHaveText("Ceci est une fautte.");
  await page.screenshot({ path: path.join(directory, "mixed-languages.png") });
  expect(report.errors).toEqual([]);
  report.status = "passed";
  report.checks.push(
    "Assigned and inherited languages; British/US separation; live language-only invalidation and undo; persistence; exact French correction/undo",
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
