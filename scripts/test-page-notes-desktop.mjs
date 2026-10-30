import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const expect = baseExpect.configure({ timeout: 45000 }),
  directory = path.resolve("work/page-notes-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-page-notes-"));
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
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const fixture = JSON.parse(
    fs.readFileSync("work/page-notes-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Per-page notes",
      template: "blank",
    });
    p.book = fixture.book;
    p.settings = fixture.settings;
    await window.alder.request("PUT", `/api/projects/${p.id}`, {
      project: p,
      expectedRevision: p.revision,
    });
    return p.id;
  }, fixture);
  const reopen = async (name = "Per-page notes") => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.locator(".project-list-item").filter({ hasText: name }).click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    refs = editor.locator("[data-note-id]"),
    sheets = page.locator(".page-sheets > .page-sheet");
  const labels = () =>
    refs.evaluateAll((nodes) => nodes.map((node) => node.dataset.noteNumber));
  const menu = async (name) => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  await expect.poll(labels).toEqual(["3", "4", "3", "4", "3"]);
  await expect(sheets).toHaveCount(3);
  await menu("Update fields");
  await expect(editor.locator("[data-cross-reference]")).toHaveText([
    "3",
    "4",
    "3",
    "4",
    "3",
  ]);
  await editor.locator("p").filter({ hasText: "ANCHOR_B" }).click();
  await page.keyboard.press("Home");
  await menu("Insert page break");
  await expect(sheets).toHaveCount(4);
  await expect.poll(labels).toEqual(["3", "3", "3", "4", "3"]);
  await editor.press("Control+z");
  await expect(sheets).toHaveCount(3);
  await expect.poll(labels).toEqual(["3", "4", "3", "4", "3"]);
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("tab", { name: "Page Layout", exact: true }).click();
  await settings
    .locator("summary")
    .filter({ hasText: /^Footnotes$/ })
    .click();
  await settings
    .getByLabel("Footnotes numbering", { exact: true })
    .selectOption("continuous");
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(labels).toEqual(["3", "4", "5", "6", "7"]);
  await page.keyboard.press("Control+,");
  await settings.getByRole("tab", { name: "Page Layout", exact: true }).click();
  await settings
    .locator("summary")
    .filter({ hasText: /^Footnotes$/ })
    .click();
  await settings
    .getByLabel("Footnotes numbering", { exact: true })
    .selectOption("page");
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(labels).toEqual(["3", "4", "3", "4", "3"]);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect.poll(labels).toEqual(["3", "4", "3", "4", "3"]);
  for (const scale of [0.5, 1, 1.5]) {
    await page.keyboard.press("Control+,");
    await settings
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await settings
      .getByLabel("UI Scale", { exact: true })
      .selectOption(String(scale));
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await expect.poll(labels).toEqual(["3", "4", "3", "4", "3"]);
    await expect(sheets).toHaveCount(3);
  }
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(3);
  await expect(page.locator(".page-card").nth(1)).toContainText("FOOT_C");
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
  expect(pdf.result.validation.pages).toBe(3);
  fs.writeFileSync(path.join(directory, "notes.pdf"), Buffer.from(pdf.bytes));
  await page.screenshot({ path: path.join(directory, "page-notes.png") });
  report.checks.push(
    "Page/continuous numbering, physical reflow after page-break insertion and undo, reference refresh, save/reopen, UI scales, Arrangement and three-page PDF",
  );
  const crowdedId = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Crowded notes",
      template: "blank",
    });
    p.settings = fixture.settings;
    const para = (text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
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
            content: Array.from({ length: 12 }, (_, i) => [
              para("Body passage before note " + i + "."),
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "CROWDED_" + i },
                  {
                    type: "document_note",
                    attrs: {
                      kind: "footnote",
                      blockId: "crowded_" + i,
                      body: {
                        type: "doc",
                        content: Array.from(
                          { length: i === 3 ? 70 : 3 },
                          (_, j) => para(`NOTE_${i}_LINE_${j}`),
                        ),
                      },
                    },
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
  }, fixture);
  await reopen("Crowded notes");
  await expect(refs).toHaveCount(12);
  await expect(
    page.locator('.page-sheets [data-note-fragment="crowded_11"]'),
  ).toBeVisible();
  const ownership = await page.evaluate(() => {
    const pages = [
      ...document.querySelectorAll(".page-sheets > .page-sheet"),
    ].map((el) => el.getBoundingClientRect());
    return [...document.querySelectorAll(".page-flow [data-note-id]")].map(
      (el) => {
        const rect = el.getBoundingClientRect();
        return {
          id: el.dataset.noteId,
          number: Number(el.dataset.noteNumber),
          page: pages.findIndex(
            (p) => rect.top >= p.top && rect.top < p.bottom,
          ),
        };
      },
    );
  });
  const counts = new Map();
  for (const note of ownership) {
    expect(note.page).toBeGreaterThanOrEqual(0);
    const count = (counts.get(note.page) || 0) + 1;
    counts.set(note.page, count);
    expect(note.number).toBe(2 + count);
  }
  expect(counts.size).toBeGreaterThan(1);
  report.crowdedOwnership = ownership;
  const crowded = await page.evaluate(async (id) => {
    const r = await window.alder.request("POST", `/api/projects/${id}/export`, {
      format: "pdf",
    });
    return [
      ...new Uint8Array(
        await (
          await fetch(window.alder.mediaBase + r.downloadUrl)
        ).arrayBuffer(),
      ),
    ];
  }, crowdedId);
  fs.writeFileSync(path.join(directory, "crowded.pdf"), Buffer.from(crowded));
  report.checks.push(
    "Crowded anchors and a 70-line continuing note settle with numbering derived from each actual reference page",
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
