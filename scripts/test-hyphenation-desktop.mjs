import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/hyphenation"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-hyphen-"));
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
  page.on("pageerror", (error) => report.errors.push(error.message));
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
      name: "Hyphenation",
      template: "blank",
    });
    p.language = "en-GB";
    Object.assign(p.settings, {
      documentKind: "docx",
      includeTitle: false,
      includeToc: false,
      footer: false,
      pageSize: "Custom",
      pageWidthMm: 90,
      pageHeightMm: 130,
      marginMm: 15,
      marginTopMm: 30,
      fontSize: 14,
    });
    p.settings.runningMatter = {
      differentFirst: false,
      differentEven: false,
      headerDistanceMm: 8,
      footerDistanceMm: 8,
      header: {
        default: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { hyphenation: true, textLanguage: "de", fontSize: 12 },
              content: [
                {
                  type: "text",
                  text: "Silbentrennungsmöglichkeiten außergewöhnlicherweise",
                },
              ],
            },
          ],
        },
      },
      footer: { default: null },
    };
    p.book = {
      version: 1,
      chapters: [
        {
          id: "c",
          title: "Text",
          include: true,
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                attrs: { hyphenation: true, textLanguage: "en-GB" },
                content: [
                  {
                    type: "text",
                    text: "extraordinary representation internationalisation characteristically ".repeat(
                      20,
                    ),
                  },
                ],
              },
              {
                type: "paragraph",
                attrs: { hyphenation: false, textLanguage: "de" },
                content: [
                  { type: "text", text: "Silbentrennung bleibt erhalten." },
                ],
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
    return p.id;
  });
  const reopen = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: "Hyphenation" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    hyphens = editor.locator(".discretionary-hyphen");
  stage("local dictionary layout");
  await expect.poll(() => hyphens.count()).toBeGreaterThan(100);
  const sourceText = await editor.evaluate((el) =>
    el.textContent.replace(/\u00ad/g, ""),
  );
  await expect(editor.locator("p").first()).toHaveAttribute("lang", "en-GB");
  const actualBreaks = await hyphens.evaluateAll(
    (nodes) =>
      nodes.filter((node) => {
        const r = node.getBoundingClientRect();
        return r.width > 0.5;
      }).length,
  );
  expect(actualBreaks).toBeGreaterThan(10);
  report.visibleHyphens = actualBreaks;
  await expect
    .poll(() =>
      page.locator("[data-running-story] .discretionary-hyphen").count(),
    )
    .toBeGreaterThan(0);
  const openParagraph = async () => {
    await expect(async () => {
      await editor
        .locator("p")
        .first()
        .click({ button: "right", position: { x: 20, y: 10 } });
      await expect(
        page.getByRole("menuitem", { name: "Paragraph…", exact: true }),
      ).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 8000 });
    await page
      .getByRole("menuitem", { name: "Paragraph…", exact: true })
      .click();
  };
  stage("toggle and undo");
  await openParagraph();
  const dialog = page.getByRole("dialog", { name: "Paragraph", exact: true });
  await dialog.getByText("Language and direction", { exact: true }).click();
  await expect(dialog.getByLabel("Paragraph language")).toHaveValue("en-GB");
  await dialog.getByLabel("Automatic hyphenation").selectOption("false");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(hyphens).toHaveCount(0);
  await editor.press("Control+z");
  await expect.poll(() => hyphens.count()).toBeGreaterThan(100);
  stage("typing and saved prose");
  const caret = await editor.evaluate((el) => {
    const p = el.querySelector("p"),
      walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let node;
    const pieces = [];
    let plain = "";
    while ((node = walker.nextNode())) {
      if (node.parentElement.closest(".ProseMirror-widget")) continue;
      pieces.push({ node, start: plain.length });
      plain += node.textContent;
    }
    const at = plain.lastIndexOf("internationalisation") + 5,
      piece = pieces.find(
        (p) => at >= p.start && at < p.start + p.node.textContent.length,
      );
    const range = document.createRange();
    range.setStart(piece.node, at - piece.start);
    range.collapse(true);
    const viewport = el.closest(".editor-scroll"),
      bounds = viewport.getBoundingClientRect();
    let rect = range.getBoundingClientRect();
    viewport.scrollTop +=
      (rect.top - bounds.top - bounds.height / 2) /
      (bounds.width / viewport.offsetWidth);
    rect = range.getBoundingClientRect();
    return { x: rect.left, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(caret.x, caret.y);
  await page.keyboard.type("Z");
  await expect
    .poll(() => editor.evaluate((el) => el.textContent.replace(/\u00ad/g, "")))
    .toContain("interZnationalisation");
  await editor.press("Control+z");
  await expect
    .poll(() => editor.evaluate((el) => el.textContent.replace(/\u00ad/g, "")))
    .not.toContain("interZnationalisation");
  await editor.press("Control+Home");
  await editor.pressSequentially("Added ");
  await expect(editor).toContainText("Added extra");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect.poll(() => hyphens.count()).toBeGreaterThan(100);
  const saved = await page.evaluate(
    (id) => window.alder.request("GET", `/api/projects/${id}`),
    id,
  );
  expect(saved.book.chapters[0].text).not.toContain("\u00ad");
  expect(saved.book.chapters[0].text).toContain(
    "Added extraordinary representation",
  );
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
  expect(pdf.result.validation.status).toBe("passed");
  fs.writeFileSync(
    path.join(directory, "hyphenation.pdf"),
    Buffer.from(pdf.bytes),
  );
  report.pages = pdf.result.validation.pages;
  await page.screenshot({ path: path.join(directory, "write.png") });
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect
    .poll(() => page.locator(".page-card .discretionary-hyphen").count())
    .toBeGreaterThan(100);
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  for (const scale of ["0.5", "1.5", "1"]) {
    await page.evaluate(
      (scale) => localStorage.setItem("alder.uiScale", scale),
      scale,
    );
    await reopen();
    await expect.poll(() => hyphens.count()).toBeGreaterThan(100);
  }
  report.checks.push(
    "Local hyphens wrap, Apply/undo, typing, plain authored text, persistence, PDF, Arrangement, UI scales.",
  );
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
