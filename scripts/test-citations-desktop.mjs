import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/citations-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-citations-ui-"));
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
      name: "Citations desktop",
      template: "blank",
    });
    p.settings = {
      ...p.settings,
      documentKind: "docx",
      includeTitle: false,
      pageSize: "A5",
    };
    p.book = {
      version: 1,
      chapters: [
        {
          id: "main",
          title: "Document",
          include: true,
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "A source supports this sentence." },
                ],
              },
              {
                type: "paragraph",
                content: [{ type: "text", text: "Another source follows." }],
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
      .filter({ hasText: "Citations desktop" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    dialog = page.getByRole("dialog", { name: "Sources", exact: true }),
    citations = editor.locator("[data-document-citation]");
  const menu = async (name) => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  await editor.press("Control+Home");
  await editor.press("End");
  await menu("Sources…");
  await dialog.getByRole("button", { name: "New source", exact: true }).click();
  await dialog.getByLabel("Source title", { exact: true }).fill("Alpha study");
  await dialog
    .getByLabel("Source authors", { exact: true })
    .fill("Smith, Alex");
  await dialog.getByLabel("Source year", { exact: true }).fill("2020");
  await dialog
    .getByLabel("Source Publisher", { exact: true })
    .fill("Example Press");
  await dialog
    .getByRole("button", { name: "Save source", exact: true })
    .click();
  await dialog
    .locator(".source-name")
    .filter({ hasText: "Alpha study" })
    .click();
  await dialog.getByLabel("Locator 1", { exact: true }).fill("12–14");
  await dialog
    .getByRole("button", { name: "Insert citation", exact: true })
    .click();
  await expect(citations).toHaveText("(Smith, 2020, pp. 12–14)");
  await expect(editor).toContainText("A source supports this sentence.");
  await editor.press("Control+z");
  await expect(citations).toHaveCount(0);
  await editor.press("Control+y");
  await expect(citations).toHaveCount(1);
  await citations.first().dblclick();
  await dialog.getByLabel("Locator 1", { exact: true }).fill("20");
  await dialog
    .getByRole("button", { name: "Apply citation", exact: true })
    .click();
  await expect(citations).toContainText("p. 20");
  await editor.press("Control+z");
  await expect(citations).toContainText("12–14");
  await editor.press("Control+End");
  await menu("Sources…");
  await dialog.getByRole("button", { name: "New source", exact: true }).click();
  await dialog.getByLabel("Source title", { exact: true }).fill("Beta study");
  await dialog
    .getByLabel("Source authors", { exact: true })
    .fill("Smith, Alex");
  await dialog.getByLabel("Source year", { exact: true }).fill("2020");
  await dialog
    .getByRole("button", { name: "Save source", exact: true })
    .click();
  await dialog
    .locator(".source-name")
    .filter({ hasText: "Beta study" })
    .click();
  await dialog
    .getByRole("button", { name: "Insert citation", exact: true })
    .click();
  await expect(citations).toHaveCount(2);
  await expect(citations.nth(0)).toContainText("2020a");
  await expect(citations.nth(1)).toContainText("2020b");
  report.checks.push(
    "Local source creation, citation insertion/editing, locators, disambiguation and single-step undo",
  );
  await editor.press("Control+End");
  await editor.press("Enter");
  await menu("Sources…");
  await dialog
    .locator("summary")
    .filter({ hasText: /^Bibliography$/ })
    .click();
  await dialog
    .getByRole("button", { name: "Insert bibliography", exact: true })
    .click();
  const bibliography = editor.locator("[data-document-bibliography]");
  await expect(bibliography).toContainText("Alpha study");
  await expect(bibliography).toContainText("Beta study");
  await expect(bibliography.locator("em").first()).toHaveText("Alpha study");
  await editor.press("Control+z");
  await expect(bibliography).toHaveCount(0);
  await editor.press("Control+y");
  await expect(bibliography).toHaveCount(1);
  await menu("Sources…");
  await dialog
    .getByLabel("Citation style", { exact: true })
    .selectOption("ieee");
  await dialog
    .getByRole("button", { name: "Update document", exact: true })
    .click();
  await expect(dialog).toContainText(
    "Document citations and bibliography updated.",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(citations.nth(0)).toContainText("[1");
  await expect(citations.nth(1)).toHaveText("[2]");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(citations).toHaveCount(2);
  await expect(bibliography).toContainText("Alpha study");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  for (const scale of ["0.5", "1", "1.5"]) {
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()
        .items.flatMap((m) => m.submenu?.items || [])
        .find((i) => i.label === "Settings…");
      Reflect.apply(item.click, item, [
        { triggeredByAccelerator: false },
        BrowserWindow.getAllWindows()[0],
        {},
      ]);
    });
    await settings
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await settings.getByLabel("UI Scale", { exact: true }).selectOption(scale);
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await menu("Sources…");
    await expect(
      dialog.getByRole("button", { name: "Close", exact: true }),
    ).toBeInViewport();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card").first()).toContainText("Alpha study");
  await page.getByRole("tab", { name: "Write", exact: true }).click();
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
    path.join(directory, "citations.pdf"),
    Buffer.from(pdf.bytes),
  );
  await page.screenshot({ path: path.join(directory, "citations.png") });
  report.checks.push(
    "Bibliography generation, style change, saving/reopening, UI scale, Arrangement and desktop PDF",
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
