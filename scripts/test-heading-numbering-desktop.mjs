import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/heading-numbering");
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-headings-"));
const report = { status: "running", checks: [], errors: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const id = await page.evaluate(async () => {
    const p = await window.alder.request("POST", "/api/projects", {
      template: "blank",
      name: "Heading numbering",
    });
    p.settings.documentKind = "docx";
    p.settings.includeTitle = false;
    const heading = (level, text) => ({
      type: "heading",
      attrs: {
        level,
        headingNumbered: true,
        blockId: text.toLowerCase().replaceAll(" ", "-"),
      },
      content: [{ type: "text", text }],
    });
    p.book = {
      version: 1,
      chapters: [
        {
          id: "chapter",
          title: "Document",
          include: true,
          document: {
            type: "doc",
            content: [
              heading(1, "First heading"),
              heading(2, "Child heading"),
              heading(1, "Last heading"),
              {
                type: "paragraph",
                content: [{ type: "text", text: "See section " }],
              },
            ],
          },
        },
      ],
    };
    await window.alder.request("PUT", `/api/projects/${p.id}`, {
      project: p,
      expectedRevision: p.revision,
    });
    localStorage.setItem("alder.project", p.id);
    return p.id;
  });
  const open = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: "Heading numbering" })
      .click();
  };
  await open();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const labels = () => editor.locator(".heading-number").allTextContents();
  await expect.poll(labels).toEqual(["1\u00a0", "1.1\u00a0", "2\u00a0"]);
  await editor.locator("h1").last().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Paragraph…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Paragraph", exact: true });
  await dialog.getByLabel("Heading restart", { exact: true }).fill("5");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(labels).toEqual(["1\u00a0", "1.1\u00a0", "5\u00a0"]);
  await expect(editor).toBeFocused();
  await editor.press("Control+z");
  await expect.poll(labels).toEqual(["1\u00a0", "1.1\u00a0", "2\u00a0"]);
  await editor.press("Control+y");
  await expect.poll(labels).toEqual(["1\u00a0", "1.1\u00a0", "5\u00a0"]);
  report.checks.push("paragraph numbering and restart with separate undo/redo");
  await editor.press("Control+End");
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Insert cross-reference…", exact: true })
    .click();
  const referenceDialog = page.getByRole("dialog", {
    name: "Insert cross-reference",
    exact: true,
  });
  await referenceDialog
    .getByLabel("Reference target", { exact: true })
    .selectOption("last-heading");
  await referenceDialog
    .getByLabel("Reference display", { exact: true })
    .selectOption("number");
  await expect(referenceDialog.getByLabel("Reference preview")).toHaveText("5");
  await referenceDialog
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  await expect(
    editor.locator('[data-cross-reference="last-heading"]'),
  ).toHaveText("5");
  await editor.press("Control+z");
  await expect(
    editor.locator('[data-cross-reference="last-heading"]'),
  ).toHaveCount(0);
  await editor.press("Control+y");
  await expect(
    editor.locator('[data-cross-reference="last-heading"]'),
  ).toHaveText("5");
  report.checks.push(
    "number-only heading reference with preview and separate undo/redo",
  );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const exported = await page.evaluate(async (id) => {
    const project = await window.alder.request("GET", `/api/projects/${id}`);
    if (project.book.chapters[0].text.includes("1.1"))
      throw Error("Derived markers entered authored text.");
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
    path.join(directory, "headings.pdf"),
    Buffer.from(exported.bytes),
  );
  expect(exported.result.validation.status).toBe("passed");
  await open();
  await expect.poll(labels).toEqual(["1\u00a0", "1.1\u00a0", "5\u00a0"]);
  await editor.locator("h1").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Paragraph…", exact: true }).click();
  await dialog
    .getByLabel("Number headings (1, 1.1, 1.1.1)", { exact: true })
    .selectOption("false");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(labels).toEqual(["1.1\u00a0", "5\u00a0"]);
  report.checks.push(
    "source wording unchanged, shared PDF, persisted restart and explicit removal",
  );
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close().catch(() => {});
}
