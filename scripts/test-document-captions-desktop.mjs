import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-captions-")),
  directory = path.resolve("work/document-captions");
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", checks: [] };
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
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Book", exact: false }).click();
  await page.getByLabel("Name", { exact: true }).fill("Caption manuscript");
  await page.getByLabel("Chapters", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.evaluate(async () => {
    const id = localStorage.getItem("alder.project"),
      project = await window.alder.request("GET", `/api/projects/${id}`);
    project.book.chapters.forEach((chapter, index) => {
      chapter.document = {
        type: "doc",
        content: [
          {
            type: "table",
            attrs: { blockId: "table-" + index },
            content: [
              {
                type: "table_row",
                content: [
                  {
                    type: "table_cell",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Cell" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "See " }] },
        ],
      };
    });
    await window.alder.request("PUT", `/api/projects/${id}`, {
      project,
      expectedRevision: project.revision,
    });
  });
  const reopen = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: "Caption manuscript" })
      .click();
  };
  await reopen();
  const menu = async (name) => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  const add = async (title) => {
    await editor.locator("td").first().click();
    await menu("Insert caption…");
    const dialog = page.getByRole("dialog", {
      name: "Insert caption",
      exact: true,
    });
    await dialog.getByLabel("Caption text", { exact: true }).fill(title);
    await expect(
      dialog.getByLabel("Caption label", { exact: true }),
    ).toHaveValue("Table");
    await expect(
      dialog.getByLabel("Caption position", { exact: true }),
    ).toHaveValue("before");
    await dialog.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(editor).toBeFocused();
  };
  stage("insert table caption and undo");
  await add("Measurements");
  await expect(editor.locator("[data-caption-label]")).toHaveText(
    "Table 1: Measurements",
  );
  await page.keyboard.type(" extra");
  await expect(editor.locator("[data-caption-label]")).toHaveText(
    "Table 1: Measurements extra",
  );
  await editor.press("Control+z");
  await editor.press("Control+z");
  await expect(editor.locator("[data-caption-label]")).toHaveCount(0);
  await editor.press("Control+y");
  await expect(editor.locator("[data-caption-label]")).toHaveText(
    "Table 1: Measurements",
  );
  await page
    .getByRole("button", { name: "Open chapter Chapter 2", exact: true })
    .click();
  await add("Comparisons");
  await expect(editor.locator("[data-caption-label]")).toHaveText(
    "Table 2: Comparisons",
  );
  report.checks.push(
    "Caption placement, editable title, focus and undo/redo pass; initial numbering includes earlier chapters.",
  );
  stage("caption reference");
  const target = await editor
    .locator("[data-caption-label]")
    .getAttribute("data-reference-target");
  await editor.press("Control+End");
  await menu("Insert cross-reference…");
  const refs = page.getByRole("dialog", {
    name: "Insert cross-reference",
    exact: true,
  });
  await refs
    .getByLabel("Reference target", { exact: true })
    .selectOption(target);
  await refs
    .getByLabel("Reference display", { exact: true })
    .selectOption("number");
  await expect(
    refs.getByLabel("Reference preview", { exact: true }),
  ).toHaveText("2");
  await refs
    .getByLabel("Reference display", { exact: true })
    .selectOption("labelNumber");
  await expect(
    refs.getByLabel("Reference preview", { exact: true }),
  ).toHaveText("Table 2");
  await refs.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(editor.locator("[data-cross-reference]")).toHaveText("Table 2");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await page
    .getByRole("button", { name: "Open chapter Chapter 2", exact: true })
    .click();
  await expect(editor.locator("[data-document-sequence]")).toHaveText("2");
  await expect(editor.locator("[data-cross-reference]")).toHaveText("Table 2");
  report.checks.push(
    "Caption targets support cross-reference insertion and survive saving/reopening.",
  );
  stage("copy and renumber");
  const html = await editor.innerHTML();
  await editor.press("Control+End");
  await editor.press("Enter");
  await editor.evaluate((element, html) => {
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData(
      "text/plain",
      "Table 2: Comparisons\nCell\nSee Table 2: Comparisons",
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, html);
  await expect(editor.locator("[data-caption-label]")).toHaveCount(2);
  await menu("Update fields");
  await expect(editor.locator("[data-caption-label]").last()).toHaveText(
    "Table 3: Comparisons",
  );
  await expect(editor.locator("[data-cross-reference]").last()).toHaveText(
    "Table 3",
  );
  const association = await editor
    .locator("[data-caption-label]")
    .last()
    .getAttribute("data-caption-target");
  expect(association).not.toBe("table-1");
  await expect(
    editor.locator(`table[data-object-id="${association}"]`),
  ).toHaveCount(1);
  await editor.press("Control+z");
  await expect(editor.locator("[data-caption-label]").last()).toHaveText(
    "Table 2: Comparisons",
  );
  await editor.press("Control+y");
  await expect(editor.locator("[data-caption-label]").last()).toHaveText(
    "Table 3: Comparisons",
  );
  await page.screenshot({ path: path.join(directory, "captions.png") });
  report.checks.push(
    "Copied table/caption/reference identities stay paired; one field update refreshes numbering and references together with undo.",
  );
  expect(errors).toEqual([]);
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
