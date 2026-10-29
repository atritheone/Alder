import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), "alder-running-headings-"),
  ),
  directory = path.resolve("work/running-headings");
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
  page.setDefaultTimeout(7000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const id = await page.evaluate(async () => {
    const p = await window.alder.request("POST", "/api/projects", {
      template: "blank",
      name: "Running heading manuscript",
    });
    const paragraph = (text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      }),
      heading = (text) => ({
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text }],
      });
    Object.assign(p.settings, {
      documentKind: "docx",
      includeTitle: false,
      includeToc: false,
      footer: false,
      runningMatter: {
        header: {
          default: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "CHAPTER: " },
                  {
                    type: "document_field",
                    attrs: { fieldKind: "heading1" },
                    content: [{ type: "text", text: "Old" }],
                  },
                ],
              },
            ],
          },
        },
      },
    });
    p.book = {
      version: 1,
      chapters: [
        {
          id: "c",
          title: "Document",
          include: true,
          document: {
            type: "doc",
            content: [
              paragraph("FIRST BODY"),
              { type: "page_break" },
              heading("Alpha"),
              paragraph("SECOND BODY"),
              heading("Beta"),
              { type: "page_break" },
              paragraph("THIRD BODY"),
              { type: "page_break" },
              heading("Gamma"),
              paragraph("FOURTH BODY"),
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
      .filter({ hasText: "Running heading manuscript" })
      .click();
  };
  await reopen();
  const sheets = page.locator(".page-sheets > .page-sheet"),
    editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    headers = sheets.locator("[data-running-story=header]");
  stage("running heading page selection");
  await expect(sheets).toHaveCount(4);
  await expect(headers).toHaveText([
    "CHAPTER: Alpha",
    "CHAPTER: Alpha",
    "CHAPTER: Beta",
    "CHAPTER: Gamma",
  ]);
  stage("edit heading and undo");
  const beta = editor.locator("h1").filter({ hasText: "Beta" });
  await beta.click();
  await editor.press("Home");
  await editor.press("Shift+End");
  await page.keyboard.insertText("Revised Beta");
  await expect(headers.nth(2)).toHaveText("CHAPTER: Revised Beta");
  await expect(headers.nth(1)).toHaveText("CHAPTER: Alpha");
  await editor.press("Control+z");
  await expect(headers.nth(2)).toHaveText("CHAPTER: Beta");
  report.checks.push(
    "First current/last preceding/first following heading; live edit and undo.",
  );
  stage("insert running field");
  await editor.press("Control+Home");
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Headers and footers…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Headers and footers",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Header text editor", exact: true })
    .fill("TITLE: ");
  await dialog
    .getByLabel("Insert header/footer field")
    .selectOption("heading1");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(headers).toHaveText([
    "TITLE: Alpha",
    "TITLE: Alpha",
    "TITLE: Beta",
    "TITLE: Gamma",
  ]);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(headers.nth(2)).toHaveText("TITLE: Beta");
  report.checks.push("Header field insertion, Apply, persistence.");
  stage("body heading field insertion and undo");
  await editor.press('Control+End');
  await page.getByRole('button',{name:'More formatting',exact:true}).click();
  await page.getByRole('menuitem',{name:'Insert field…',exact:true}).click();
  const fieldDialog=page.getByRole('dialog',{name:'Insert field',exact:true});
  await fieldDialog.getByLabel('Field',{exact:true}).selectOption('heading1');
  await fieldDialog.getByRole('button',{name:'Insert',exact:true}).click();
  await expect(fieldDialog).toHaveCount(0);
  await expect(editor.locator('[data-document-field=heading1]')).toHaveText('Gamma');
  await editor.press('Control+z');
  await expect(editor.locator('[data-document-field=heading1]')).toHaveCount(0);
  await expect(page.locator('.save-status')).toHaveText('Saved');
  report.checks.push('Body insertion resolves the publication heading and has one-step undo.');
  stage("shared PDF");
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
    path.join(directory, "running-headings.pdf"),
    Buffer.from(pdf.bytes),
  );
  expect(pdf.result.validation.status).toBe("passed");
  expect(pdf.result.validation.pages).toBe(4);
  await page.screenshot({ path: path.join(directory, "write.png") });
  stage("Arrangement and scale");
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(4);
  await expect(
    page.locator(".page-card").locator("[data-running-story=header]"),
  ).toHaveText(["TITLE: Alpha", "TITLE: Alpha", "TITLE: Beta", "TITLE: Gamma"]);
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  for (const scale of ["0.5", "1.5", "1"]) {
    await page.evaluate(
      (scale) => localStorage.setItem("alder.uiScale", scale),
      scale,
    );
    await reopen();
    await expect(sheets).toHaveCount(4);
    await expect(headers.nth(2)).toHaveText("TITLE: Beta");
  }
  report.checks.push(
    "Four-page shared PDF, Arrangement and 50/100/150% UI scales.",
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
