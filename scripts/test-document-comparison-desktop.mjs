import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/document-comparison-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-comparison-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", errors: [] };
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
  const sources = await page.evaluate(async () => {
    const copies = [];
    for (const [name, text] of [
      [
        "Original",
        ["Deleted paragraph.", "Anchor one.", "Old wording.", "Anchor two."],
      ],
      [
        "Revised",
        ["Anchor one.", "New wording.", "Anchor two.", "Inserted paragraph."],
      ],
    ]) {
      const p = await window.alder.request("POST", "/api/projects", {
        name,
        template: "blank",
      });
      p.book = {
        version: 1,
        chapters: [
          {
            id: "main",
            title: "Text",
            include: true,
            document: {
              type: "doc",
              content: text.map((text) => ({
                type: "paragraph",
                content: [{ type: "text", text }],
              })),
            },
          },
        ],
      };
      for (const node of p.book.chapters[0].document.content) {
        const text = node.content[0].text;
        if (!/Deleted|Inserted|wording/.test(text)) continue;
        const id = text.includes("wording") ? "shared" : name;
        const thread = {
          resolved: false,
          entries: [
            {
              id: "entry",
              author: name,
              text: `${name} comment on ${text}`,
              date: "2026-11-03T00:00:00Z",
            },
          ],
        };
        const anchor = (edge) => ({
          type: "comment_anchor",
          attrs: { threadId: id, edge, thread },
        });
        node.content = [anchor("start"), ...node.content, anchor("end")];
      }
      p.settings.documentKind = "docx";
      p.settings.includeTitle = false;
      copies.push(
        await window.alder.request("PUT", `/api/projects/${p.id}`, {
          project: p,
          expectedRevision: p.revision,
        }),
      );
    }
    return copies;
  });
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Original" })
    .first()
    .click();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    dialog = page.getByRole("dialog", {
      name: "Compare documents",
      exact: true,
    });
  await expect(editor).toContainText("Old wording.");
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  const menu = async () => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Compare documents…", exact: true })
      .click();
    await expect(dialog).toBeVisible();
  };
  for (const scale of [0.5, 1.5, 1]) {
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
    await menu();
    await expect(
      dialog.getByRole("button", { name: "Preview", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  }
  await menu();
  await dialog
    .getByLabel("Revised document", { exact: true })
    .selectOption(sources[1].id);
  await dialog.getByLabel("Comparison author", { exact: true }).fill("Editor");
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    dialog.getByLabel("Comparison summary", { exact: true }),
  ).toContainText("3 changes");
  await page.screenshot({ path: path.join(directory, "comparison.png") });
  await dialog
    .getByRole("button", { name: "Create reviewed copy", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(editor.locator("[data-revision-block]")).toHaveCount(2);
  await expect(editor.locator("[data-comment-thread]")).toHaveCount(6);
  const result = await page.evaluate(async () => {
    const list = await window.alder.request("GET", "/api/projects");
    const item = list.projects.find((p) => p.name === "Original - comparison");
    return window.alder.request("GET", `/api/projects/${item.id}`);
  });
  for (const source of sources) {
    const saved = await page.evaluate(
      (id) => window.alder.request("GET", `/api/projects/${id}`),
      source.id,
    );
    expect(saved.book).toEqual(source.book);
  }
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Review changes…", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Review changes",
    exact: true,
  });
  await expect(review.locator(".review-list>button")).toHaveCount(3);
  await review
    .getByLabel("Review preview", { exact: true })
    .selectOption("original");
  await expect(
    review.getByLabel("original document preview", { exact: true }),
  ).toHaveText("Deleted paragraph.Anchor one.Old wording.Anchor two.");
  await review.getByLabel("Review scope", { exact: true }).selectOption("all");
  await review.getByRole("button", { name: "Accept", exact: true }).click();
  await review.getByRole("button", { name: "Done", exact: true }).click();
  await expect(editor).toHaveText(
    "Anchor one.New wording.Anchor two.Inserted paragraph.",
  );
  await editor.press("Control+z");
  await expect(editor.locator("[data-revision-block]")).toHaveCount(2);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Original - comparison" })
    .first()
    .click();
  await expect(editor.locator("[data-revision-block]")).toHaveCount(2);
  expect(report.errors).toEqual([]);
  report.status = "passed";
  report.project = result.id;
} catch (error) {
  report.error = error.stack;
  if (page)
    await page
      .screenshot({ path: path.join(directory, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  if (app) await app.close();
}
