import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-running-")),
  directory = path.resolve("work/running-matter");
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
      name: "Running manuscript",
    });
    const text = (text) => ({ type: "text", text }),
      paragraph = (textValue) => ({
        type: "paragraph",
        content: [text(textValue)],
      }),
      story = (textValue, field) => ({
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { align: "right" },
            content: [
              { ...text(textValue), marks: [{ type: "strong" }] },
              ...(field
                ? [
                    {
                      type: "document_field",
                      attrs: { fieldKind: field },
                      content: [text("99")],
                    },
                  ]
                : []),
            ],
          },
        ],
      });
    Object.assign(p.settings, {
      documentKind: "docx",
      includeTitle: false,
      runningMatter: {
        differentFirst: true,
        differentEven: true,
        headerDistanceMm: 8,
        footerDistanceMm: 9,
        header: {
          default: story("ODD HEADER"),
          first: story("FIRST HEADER"),
          even: story("EVEN HEADER"),
        },
        footer: {
          default: story("Page ", "page"),
          first: null,
          even: story("Total ", "pageCount"),
        },
      },
    });
    const even = p.settings.runningMatter.header.even.content[0];
    even.content[0].text = "EVEN\tHEADER";
    Object.assign(even.attrs, {
      align: "left",
      tabStops: [{ position: 144, align: "right", leader: "dot" }],
      lineSpacingMode: "exact",
      lineSpacing: 14,
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
              paragraph("FIRST BODY"),
              { type: "page_break" },
              paragraph("SECOND BODY"),
              {
                type: "section_break",
                attrs: {
                  blockId: "section",
                  kind: "nextPage",
                  page: {},
                  runningMatter: {
                    differentFirst: false,
                    header: { default: story("SECTION HEADER") },
                  },
                },
              },
              paragraph("THIRD BODY"),
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
      .filter({ hasText: "Running manuscript" })
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
    });
  const menu = async () => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Headers and footers…", exact: true })
      .click();
  };
  stage("initial page variants");
  await expect(sheets).toHaveCount(3);
  await expect(sheets.nth(0).locator("[data-running-story=header]")).toHaveText(
    "FIRST HEADER",
  );
  await expect(sheets.nth(1).locator("[data-running-story=footer]")).toHaveText(
    "Total 3",
  );
  await expect(sheets.nth(2).locator("[data-running-story=header]")).toHaveText(
    "SECTION HEADER",
  );
  await expect(sheets.nth(2).locator("[data-running-story=footer]")).toHaveText(
    "Page 3",
  );
  await expect(editor).not.toContainText("HEADER");
  expect(
    await sheets
      .nth(1)
      .locator("[data-running-story=header] .alder-tab")
      .evaluate((el) => parseFloat(el.style.width)),
  ).toBeGreaterThan(80);
  report.checks.push(
    "First/odd/even stories, independent section override and live page/total fields stay outside the body.",
  );
  stage("edit cancel and undo");
  await editor.press("Control+Home");
  await menu();
  await expect(dialog.getByLabel("Header/footer alignment")).toHaveValue(
    "right",
  );
  await expect(
    dialog.getByRole("button", { name: "Bold", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByLabel("Header/footer page variant").selectOption("first");
  await dialog
    .getByRole("textbox", { name: "Header text editor", exact: true })
    .fill("Cancelled");
  await dialog.press("Escape");
  await expect(
    sheets.first().locator("[data-running-story=header]"),
  ).toHaveText("FIRST HEADER");
  await menu();
  await dialog.getByLabel("Header/footer page variant").selectOption("first");
  await dialog
    .getByRole("textbox", { name: "Header text editor", exact: true })
    .fill("EDITED FIRST");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    sheets.first().locator("[data-running-story=header]"),
  ).toHaveText("EDITED FIRST");
  await editor.press("Control+z");
  await expect(
    sheets.first().locator("[data-running-story=header]"),
  ).toHaveText("FIRST HEADER");
  await editor.press("Control+y");
  await expect(
    sheets.first().locator("[data-running-story=header]"),
  ).toHaveText("EDITED FIRST");
  report.checks.push(
    "Cancel changes nothing; Apply and undo/redo update running text without changing the body.",
  );
  stage("overflow and links");
  await menu();
  await dialog.getByLabel("Header/footer distance").fill("100");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("needs more room");
  await dialog.press("Escape");
  await editor.press("Control+End");
  await menu();
  await expect(dialog.getByLabel("Link to previous")).not.toBeChecked();
  await dialog.getByLabel("Link to previous").check();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(sheets.nth(2).locator("[data-running-story=header]")).toHaveText(
    "ODD HEADER",
  );
  await editor.press("Control+z");
  await expect(sheets.nth(2).locator("[data-running-story=header]")).toHaveText(
    "SECTION HEADER",
  );
  report.checks.push(
    "Overlapping running text is refused; linking a single variant and undo preserve all other stories.",
  );
  stage("reopen and PDF");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(
    sheets.first().locator("[data-running-story=header]"),
  ).toHaveText("EDITED FIRST");
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
  fs.writeFileSync(path.join(directory, "running.pdf"), Buffer.from(pdf.bytes));
  expect(pdf.result.validation.status).toBe("passed");
  expect(pdf.result.validation.pages).toBe(3);
  await page.screenshot({ path: path.join(directory, "write.png") });
  await editor.press("Control+Home");
  await menu();
  await page.screenshot({ path: path.join(directory, "dialog.png") });
  await dialog.press("Escape");
  report.checks.push(
    "Saved stories reopen and the shared desktop PDF retains all three physical pages.",
  );
  stage("Arrangement and UI scales");
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(3);
  await expect(
    page.locator(".page-card").nth(1).locator("[data-running-story=footer]"),
  ).toHaveText("Total 3");
  await expect(
    page.locator(".page-card").nth(2).locator("[data-running-story=header]"),
  ).toHaveText("SECTION HEADER");
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  for (const scale of ["0.5", "1", "1.5"]) {
    await page.evaluate(
      (scale) => localStorage.setItem("alder.uiScale", scale),
      scale,
    );
    await reopen();
    await expect(sheets).toHaveCount(3);
    await expect(
      sheets.nth(1).locator("[data-running-story=footer]"),
    ).toHaveText("Total 3");
    await editor.press("Control+Home");
    await menu();
    const fits = await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.left >= 0 &&
        r.right <= innerWidth &&
        r.top >= 0 &&
        r.bottom <= innerHeight
      );
    });
    expect(fits).toBe(true);
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  report.checks.push(
    "Arrangement retains the same stories; tabs/exact leading render and dialogs fit at 50/100/150% UI scale.",
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
