import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-contents-")),
  directory = path.resolve("work/document-contents");
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
  page.setDefaultTimeout(6500);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const id = await page.evaluate(async () => {
    const p = await window.alder.request("POST", "/api/projects", {
      template: "blank",
      name: "Contents manuscript",
    });
    p.settings.documentKind = "docx";
    p.settings.includeTitle = false;
    p.styles.push({
      id: "contents-entry",
      name: "Contents entry",
      kind: "paragraph",
      fontSize: 14,
      color: "#283f60",
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
            content: Array.from({ length: 45 }, (_, i) => [
              {
                type: "heading",
                attrs: {
                  blockId: `heading-${i}`,
                  level: i % 3 === 0 ? 1 : 2,
                  headingNumbered: true,
                },
                content: [
                  {
                    type: "text",
                    text: `HEADING_${String(i).padStart(2, "0")} Description`,
                  },
                ],
              },
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: `Body paragraph ${i}. This text stays authored and editable.`,
                  },
                ],
              },
            ]).flat(),
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
      .filter({ hasText: "Contents manuscript" })
      .click();
  };
  await reopen();
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
  stage("insert and undo");
  await editor.click();
  await editor.press("Control+Home");
  await menu("Insert table of contents…");
  const dialog = page.getByRole("dialog", {
    name: "Table of contents",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor.locator("[data-document-contents]")).toHaveCount(0);
  await menu("Insert table of contents…");
  await dialog
    .getByLabel("Contents entry style", { exact: true })
    .selectOption("contents-entry");
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  const toc = editor.locator("[data-document-contents]");
  await expect(toc).toHaveCount(1, { timeout: 15000 });
  await expect(toc.locator('[data-reference-format="page"]').last()).toHaveText(
    "7",
  );
  await expect(toc.locator("p")).toHaveCount(46);
  await expect(
    toc.locator(
      '[data-cross-reference="heading-44"][data-reference-format="text"]',
    ),
  ).toHaveText("HEADING_44 Description");
  await editor.press("Control+z");
  await expect(toc).toHaveCount(0);
  await editor.press("Control+y");
  await expect(toc).toHaveCount(1);
  report.checks.push("insert, heading links, style and single undo/redo");
  stage("source edit and refresh");
  await editor.locator("h1").first().click();
  await editor.press("Home");
  await page.keyboard.type("Renamed ");
  await menu("Update fields");
  await expect(
    toc.locator(
      '[data-cross-reference="heading-0"][data-reference-format="text"]',
    ),
  ).toHaveText("Renamed HEADING_00 Description", {timeout:15000});
  await expect(toc.locator("p").nth(1)).toHaveCSS("color", "rgb(40, 63, 96)");
  await expect
    .poll(
      () => toc.locator('[data-reference-format="page"]').allTextContents(),
      { timeout: 15000 },
    )
    .toEqual(
      Array.from({ length: 45 }, () => expect.stringMatching(/^[1-9][0-9]*$/)),
    );
  report.pageReferences = await toc
    .locator('[data-reference-format="page"]')
    .allTextContents();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  stage("shared PDF");
  const output = await page.evaluate(async (id) => {
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
    path.join(directory, "contents.pdf"),
    Buffer.from(output.bytes),
  );
  expect(output.result.validation.status).toBe("passed");
  report.pdf = output.result.validation;
  stage("ignore a stale field calculation");
  await editor.focus();
  await editor
    .locator("h1")
    .first()
    .evaluate(async (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("alder-update-references")),
  );
  await page.keyboard.type(" draft");
  await expect(page.locator(".status-hint")).toContainText(
    "document changed while fields were updating",
    { timeout: 15000 },
  );
  await expect(editor.locator("h1").first()).toContainText(" draft");
  await menu("Update fields");
  await expect(
    toc.locator(
      '[data-cross-reference="heading-0"][data-reference-format="text"]',
    ),
  ).toContainText(" draft", { timeout: 15000 });
  await expect(page.locator(".save-status")).toHaveText("Saved");
  report.checks.push(
    "cancellation and stale pagination leave current edits intact",
  );
  stage("reopen and source navigation");
  await reopen();
  await expect(toc).toHaveCount(1);
  await expect(toc.locator("p")).toHaveCount(46);
  await toc
    .locator(
      '[data-cross-reference="heading-44"][data-reference-format="text"]',
    )
    .click({ modifiers: ["Control"] });
  await expect(editor).toBeFocused();
  await expect
    .poll(() =>
      editor.evaluate(
        (el) =>
          window.getSelection()?.anchorNode?.parentElement?.closest("h2")
            ?.textContent,
      ),
    )
    .toContain("HEADING_44");
  report.checks.push(
    "refresh retains entry style, multipage contents PDF, persistence and navigation",
  );
  stage("mixed section numbering");
  const sectionValues = await page.evaluate(async (id) => {
    const p = await window.alder.request("GET", `/api/projects/${id}`);
    p.settings.firstPageNumber = 4;
    p.settings.pageNumberFormat = "lowerRoman";
    p.book.chapters[0].document = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, blockId: "front" },
          content: [
            { type: "text", text: "Front " },
            {
              type: "document_field",
              attrs: { fieldKind: "page", blockId: "front-page" },
              content: [{ type: "text", text: "?" }],
            },
          ],
        },
        {
          type: "section_break",
          attrs: {
            kind: "nextPage",
            page: {},
            numberingStart: 9,
            numberingFormat: "decimal",
          },
        },
        {
          type: "heading",
          attrs: { level: 1, blockId: "body" },
          content: [{ type: "text", text: "Body" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "cross_reference",
              attrs: { targetId: "front", referenceFormat: "page" },
              content: [{ type: "text", text: "?" }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "document_field",
              attrs: { fieldKind: "page", blockId: "body-page" },
              content: [{ type: "text", text: "?" }],
            },
            { type: "text", text: " of " },
            {
              type: "document_field",
              attrs: { fieldKind: "pageCount", blockId: "page-count" },
              content: [{ type: "text", text: "?" }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "cross_reference",
              attrs: { targetId: "front", referenceFormat: "text" },
              content: [{ type: "text", text: "?" }],
            },
          ],
        },
      ],
    };
    return window.alder.request("POST", `/api/projects/${id}/layout-fields`, {
      project: p,
    });
  }, id);
  expect(sectionValues.references.front).toBe("iv");
  expect(sectionValues.references.body).toBe("9");
  expect(sectionValues.pages).toBe(2);
  expect(sectionValues.fields).toEqual({
    "front-page": "iv",
    "body-page": "9",
    "page-count": "2",
  });
  report.checks.push(
    "whole-publication page references honour Roman numbering and section restart",
  );
  stage("figure and table lists");
  await page.evaluate(async (id) => {
    const p = await window.alder.request("GET", `/api/projects/${id}`);
    p.book.chapters[0].document = {
      type: "doc",
      content: [
        { type: "paragraph" },
        ...["Figure", "Table", "Figure"].flatMap((label, i) => [
          {
            type: "paragraph",
            attrs: { captionLabel: label, blockId: `caption-${i}` },
            content: [
              { type: "text", text: label + " " },
              {
                type: "sequence",
                attrs: { sequenceName: label },
                content: [{ type: "text", text: "99" }],
              },
              { type: "text", text: ": Caption " + i },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        ]),
      ],
    };
    await window.alder.request("PUT", `/api/projects/${id}`, {
      project: p,
      expectedRevision: p.revision,
    });
  }, id);
  await reopen();
  await editor.focus();
  await editor.press("Control+Home");
  await menu("Insert table of contents…");
  await dialog
    .getByLabel("Contents type", { exact: true })
    .selectOption("figures");
  await expect(
    dialog.getByLabel("Contents title", { exact: true }),
  ).toHaveValue("List of figures");
  await expect(
    dialog.getByLabel("Contents heading levels", { exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  const figures = editor.locator('[data-contents-kind="figures"]');
  await expect(figures).toHaveCount(1, { timeout: 15000 });
  await expect(figures.locator('[data-reference-format="text"]')).toHaveText([
    "Figure 1: Caption 0",
    "Figure 2: Caption 2",
  ]);
  await expect(figures.locator('[data-reference-format="page"]')).toHaveText([
    "1",
    "1",
  ]);
  await editor.press("Control+End");
  await menu("Insert table of contents…");
  await dialog
    .getByLabel("Contents type", { exact: true })
    .selectOption("tables");
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(
    editor.locator(
      '[data-contents-kind="tables"] [data-reference-format="text"]',
    ),
  ).toHaveText("Table 1: Caption 1", { timeout: 15000 });
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(figures).toHaveCount(1);
  await expect(editor.locator('[data-contents-kind="tables"]')).toHaveCount(1);
  report.checks.push(
    "figure/table lists use independent sequences, calculated page numbers and persisted types",
  );
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.statusHint=await page?.locator('.status-hint').allTextContents().catch(()=>[]);
  report.visibleErrors=await page?.locator('[role=alert]').allTextContents().catch(()=>[]);
  report.dialogError = await page
    ?.getByRole("alert")
    .allTextContents()
    .catch(() => []);
  report.dialogText = await page
    ?.getByRole("dialog")
    .allTextContents()
    .catch(() => []);
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
