import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-structure-guides-"));
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  timeout: 60000,
});
let page;
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const tools = page.locator(".book-main .format-toolbar");
  const toggle = tools.getByRole("button", {
    name: "Show structure",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(editor.locator('[data-kind="paragraph"]')).toHaveCount(1);
  await expect(
    page.locator(".book-main .structure-region-body").first(),
  ).toBeVisible();
  await expect(editor).toHaveText("");
  await page.screenshot({ path: "work/structure-blank.png" });

  const text = (text) => ({ type: "text", text });
  const p = (value, attrs = {}) => ({
    type: "paragraph",
    attrs,
    content: [text(value)],
  });
  const content = [
    {
      type: "heading",
      attrs: { level: 1, keepWithNext: true },
      content: [text("A document you can see into")],
    },
    {
      ...p(
        "Spaces and paragraphs are visible. Tabs\tand nonbreaking\u00a0spaces are distinct.",
        {
          firstLineIndent: 18,
          leftIndent: 12,
          spaceBefore: 6,
          spaceAfter: 14,
          keepTogether: true,
        },
      ),
      content: [
        text(
          "Spaces and paragraphs are visible. Tabs\tand nonbreaking\u00a0spaces are distinct.",
        ),
        { type: "hard_break" },
        text("A manual line break stays inside this paragraph."),
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text_box",
          attrs: {
            blockId: "anchored-box",
            width: 130,
            minHeight: 55,
            padding: 6,
            borderWidth: 0,
            fill: "#ffffff",
            wrap: "right",
          },
          content: [text("Anchored text box")],
        },
        text(
          "This paragraph owns the floating text box. Its anchor remains attached to the paragraph when the writing moves.",
        ),
      ],
    },
    {
      type: "table",
      content: [
        {
          type: "table_row",
          content: [
            {
              type: "table_cell",
              attrs: { borderWidth: 0 },
              content: [p("Borderless cell")],
            },
            {
              type: "table_cell",
              attrs: { borderWidth: 0 },
              content: [p("Still a table")],
            },
          ],
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        text("A field: "),
        {
          type: "document_field",
          attrs: { fieldKind: "title" },
          content: [text("Structure fixture")],
        },
        text(". A bookmark: "),
        { type: "bookmark", attrs: { name: "target", blockId: "target-mark" } },
        text("destination"),
      ],
    },
    { type: "page_break" },
    p("An explicit page break starts this page."),
    {
      type: "section_break",
      attrs: {
        kind: "nextPage",
        blockId: "two-columns",
        page: {
          pageSize: "A5",
          orientation: "landscape",
          marginTopMm: 14,
          marginBottomMm: 17,
          marginLeftMm: 24,
          marginRightMm: 12,
          columns: { count: 2, gapMm: 8 },
        },
      },
    },
    p("This section has its own paper, margins and columns."),
    { type: "column_break" },
    ...Array.from({ length: 12 }, (_, i) =>
      p(
        `Passage ${i + 1}. Natural wrapping has no break marks. Text flows through columns and across pages without changing its stored structure.`,
      ),
    ),
  ];
  await page.evaluate(async (content) => {
    const project = await window.alder.request("POST", "/api/projects", {
      name: "Structure fixture",
      template: "blank",
    });
    project.settings = {
      ...project.settings,
      documentKind: "docx",
      header: "Structure fixture",
      footer: true,
      includeTitle: false,
      marginLeftMm: 24,
      marginRightMm: 18,
      mirrorMargins: true,
    };
    project.book = {
      version: 1,
      chapters: [
        {
          id: "main",
          title: "Text",
          include: true,
          document: { type: "doc", content },
        },
      ],
    };
    await window.alder.request("PUT", `/api/projects/${project.id}`, {
      project,
      expectedRevision: project.revision,
    });
  }, content);
  const reopen = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: "Structure fixture" })
      .click();
    await expect(editor).toBeVisible();
    await expect(page.locator(".save-status")).toHaveText("Saved");
  };
  await reopen();
  await expect(
    page
      .locator(".book-main .document-structure-layer .structure-object-cue")
      .first(),
  ).toBeAttached();
  await expect(
    page.locator(".book-main .structure-region-column").first(),
  ).toBeAttached();
  await expect(
    page.locator(".book-main .structure-break-cue").first(),
  ).toBeAttached();
  const measure = () =>
    editor.evaluate((element) => ({
      text: element.textContent,
      paragraphs: [...element.querySelectorAll("p")].map((p) => {
        const r = p.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      }),
      sheets: [
        ...element.closest(".flow-canvas").querySelectorAll(".page-sheet"),
      ].map((sheet) => {
        const r = sheet.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      }),
    }));
  const baseline = await measure();
  const tab = editor.locator(".structure-tab");
  expect(
    await editor
      .locator('p[style*="text-indent"] .structure-whitespace')
      .first()
      .evaluate((element) => getComputedStyle(element, "::after").textIndent),
  ).toBe("0px");
  expect(
    await tab.evaluate(
      (element) => getComputedStyle(element, "::before").visibility,
    ),
  ).toBe("visible");
  const sheet = await page
    .locator(".book-main .page-sheet")
    .first()
    .boundingBox();
  await page.screenshot({
    path: "work/structure-rich.png",
    scale: "css",
    clip: {
      x: sheet.x - 20,
      y: sheet.y,
      width: sheet.width + 40,
      height: Math.min(sheet.height, 520),
    },
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(
    await tab.evaluate(
      (element) => getComputedStyle(element, "::before").visibility,
    ),
  ).toBe("hidden");
  expect(
    await tab.evaluate(
      (element) => getComputedStyle(element, "::after").visibility,
    ),
  ).toBe("visible");
  await expect(
    page.locator(".book-main .document-structure-layer"),
  ).toBeHidden();
  await expect(
    page.locator(".book-main .page-structure-guides").first(),
  ).toBeHidden();
  expect(await measure()).toEqual(baseline);
  await reopen();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await editor.locator("[data-text-box]").click();
  await expect(
    page.locator(".book-main .structure-anchor-link"),
  ).toBeAttached();
  await page.screenshot({ path: "work/structure-anchor.png" });
  const pageRegion = () =>
    page
      .locator(".book-main .page-sheet")
      .first()
      .evaluate((sheet) => {
        const outer = sheet.getBoundingClientRect(),
          guide = sheet
            .querySelector(".structure-region-body")
            .getBoundingClientRect();
        return [
          (guide.x - outer.x) / outer.width,
          (guide.y - outer.y) / outer.height,
          guide.width / outer.width,
          guide.height / outer.height,
        ];
      });
  const region = await pageRegion();
  for (const [scale, zoom] of [
    ["0.5", "0.5"],
    ["1.5", "1.15"],
    ["1", "0.8"],
  ]) {
    await page.keyboard.press("ControlOrMeta+,");
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await settings
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await settings.getByLabel("UI Scale", { exact: true }).selectOption(scale);
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByLabel("Page zoom", { exact: true }).selectOption(zoom);
    const measured = await pageRegion();
    measured.forEach((value, index) =>
      expect(value).toBeCloseTo(region[index], 3),
    );
  }
  // The separate Sandbox uses the same master switch.
  const sandboxToggle = page.getByRole("button", {
    name: "Toggle sandbox",
    exact: true,
  });
  if ((await sandboxToggle.getAttribute("aria-expanded")) === "false")
    await sandboxToggle.click();
  await page
    .locator(".detail-heading")
    .getByRole("tab", { name: "Sandbox", exact: true })
    .click();
  const sandbox = page.getByRole("textbox", {
    name: "Sandbox text editor",
    exact: true,
  });
  await sandbox.fill("A separate draft.\nAnother paragraph.");
  const sandboxStructure = page
    .locator(".detail-pane .format-toolbar")
    .getByRole("button", { name: "Show structure", exact: true });
  await expect(sandboxStructure).toHaveAttribute("aria-pressed", "true");
  await sandboxStructure.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await sandboxStructure.click();
  await sandboxToggle.click();
  // Arrangement copies and publication preview contain no editing guide layer.
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-snapshot").first()).toBeVisible();
  expect(
    await page
      .locator(
        ".page-snapshot .structure-marker,.page-snapshot .document-structure-layer,.page-snapshot .page-structure-guides",
      )
      .count(),
  ).toBe(0);
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".publication-canvas-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 60000 },
  );
  await expect(
    page.locator(".publication-canvas-scroll canvas").first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back To Write", exact: true })
    .click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  expect(await page.locator(".book-main .show-structure").count()).toBe(0);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      status: "passed",
      defaultOn: true,
      persisted: true,
      geometryUnchanged: true,
      sandbox: true,
      mixedLayouts: true,
      anchors: true,
      cleanArrangementAndPreview: true,
      errors,
    }),
  );
} catch (error) {
  await page
    ?.screenshot({ path: "work/structure-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  const timer = setTimeout(() => app.process().kill(), 10000);
  try {
    await app.close();
  } finally {
    clearTimeout(timer);
  }
}
