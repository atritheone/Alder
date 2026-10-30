import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/accessibility-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-accessibility-"));
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
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const image = JSON.parse(
    fs.readFileSync("work/running-images-word/fixture-project.json", "utf8"),
  ).assets[0].data;
  const id = await page.evaluate(async (image) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Accessibility checks",
      template: "blank",
    });
    const asset = await window.alder.upload(
      `/api/projects/${p.id}/assets?register=false`,
      "Diagram.png",
      [...Uint8Array.from(atob(image), (c) => c.charCodeAt(0))],
      {},
    );
    const text = (value) => ({ type: "text", text: value }),
      para = (value) => ({ type: "paragraph", content: [text(value)] }),
      doc = (...content) => ({ type: "doc", content });
    const picture = {
      type: "image",
      attrs: {
        assetId: asset.id,
        src: `/api/projects/${p.id}/assets/${asset.id}`,
        alt: "",
        width: 80,
      },
    };
    const link = {
      type: "paragraph",
      content: [
        {
          ...text("Click here"),
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
      ],
    };
    p.assets = [asset];
    p.settings.documentKind = "book";
    p.settings.includeTitle = false;
    p.settings.runningMatter = {
      differentFirst: true,
      header: { first: doc(link) },
    };
    p.book = {
      version: 1,
      chapters: [
        {
          id: "one",
          title: "First chapter",
          include: true,
          document: doc(para("First chapter body."), picture, {
            type: "table",
            content: [
              {
                type: "table_row",
                content: [{ type: "table_cell", content: [para("Data")] }],
              },
            ],
          }),
        },
        {
          id: "two",
          title: "Second chapter",
          include: true,
          document: doc(
            {
              type: "heading",
              attrs: { level: 4 },
              content: [text("Skipped heading")],
            },
            para("Second chapter body."),
            {
              type: "paragraph",
              content: [
                text("With note"),
                {
                  type: "document_note",
                  attrs: { kind: "footnote", body: doc(link) },
                },
              ],
            },
          ),
        },
        {
          id: "excluded",
          title: "Excluded",
          include: false,
          document: doc(picture),
        },
      ],
    };
    await window.alder.request("PUT", `/api/projects/${p.id}`, {
      project: p,
      expectedRevision: p.revision,
    });
    return p.id;
  }, image);
  const reopen = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: "Accessibility checks" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    dialog = page.getByRole("dialog", {
      name: "Document accessibility",
      exact: true,
    });
  const open = async () => {
    await editor.focus();
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Check accessibility…", exact: true })
      .click();
    await expect(dialog).toBeVisible();
  };
  await open();
  await expect(
    dialog.locator('[data-accessibility-code="image-description"]'),
  ).toHaveCount(1);
  await expect(
    dialog.locator('[data-accessibility-code="table-headers"]'),
  ).toHaveCount(1);
  await expect(
    dialog.locator('[data-accessibility-code="heading-order"]'),
  ).toHaveCount(1);
  await expect(
    dialog.locator('[data-accessibility-code="link-purpose"]'),
  ).toHaveCount(2);
  await dialog
    .locator('[data-accessibility-code="heading-order"]')
    .getByRole("button", { name: "Go to item" })
    .click();
  await expect(editor).toContainText("Second chapter body.");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.getSelection()?.anchorNode?.parentElement?.closest("h4")
            ?.textContent,
      ),
    )
    .toBe("Skipped heading");
  await open();
  await dialog
    .locator('[data-accessibility-code="link-purpose"]')
    .filter({ hasText: "Footnote" })
    .getByRole("button", { name: "Go to item" })
    .click();
  const notes = page.getByRole("dialog", { name: "Notes", exact: true });
  await expect(notes).toBeVisible();
  await notes.press("Escape");
  await open();
  await dialog
    .locator('[data-accessibility-code="link-purpose"]')
    .filter({ hasText: "header (first)" })
    .getByRole("button", { name: "Go to item" })
    .click();
  const running = page.getByRole("dialog", {
    name: "Headers and footers",
    exact: true,
  });
  await expect(running).toBeVisible();
  await expect(
    running.getByLabel("Header/footer page variant", { exact: true }),
  ).toHaveValue("first");
  await running.press("Escape");
  await open();
  await dialog
    .locator('[data-accessibility-code="image-description"]')
    .getByRole("button", { name: "Go to item" })
    .click();
  const properties = page.getByRole("dialog", {
    name: "Image properties",
    exact: true,
  });
  await expect(properties).toBeVisible();
  await properties
    .getByLabel("Image alternative text", { exact: true })
    .fill("A blue square diagram");
  await properties.getByRole("button", { name: "Apply", exact: true }).click();
  await open();
  await expect(
    dialog.locator('[data-accessibility-code="image-description"]'),
  ).toHaveCount(0);
  await dialog.press("Escape");
  await editor.focus();
  await page.keyboard.press("Control+z");
  await open();
  await expect(
    dialog.locator('[data-accessibility-code="image-description"]'),
  ).toHaveCount(1);
  await dialog.press("Escape");
  await editor.focus();
  await page.keyboard.press("Control+y");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await open();
  await expect(
    dialog.locator('[data-accessibility-code="image-description"]'),
  ).toHaveCount(0);
  for (const scale of [0.5, 1, 1.5]) {
    await dialog.press("Escape");
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
    await open();
    await expect(
      dialog.getByRole("button", { name: "Done", exact: true }),
    ).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: "Done", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Close accessibility checks" }),
    ).toBeFocused();
  }
  await page.screenshot({ path: path.join(directory, "accessibility.png") });
  await dialog.press("Escape");
  const saved = await page.evaluate(
    (id) => window.alder.request("GET", `/api/projects/${id}`),
    id,
  );
  expect(saved.book.chapters[1].text).toContain("Second chapter body.");
  report.checks.push(
    "Included chapters, issue navigation across chapters, note and first-page story navigation, image correction/undo/redo, save/reopen, keyboard focus and UI scales 50/100/150%",
  );
  expect(report.errors).toEqual([]);
  report.status = "passed";
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
