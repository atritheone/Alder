import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const expect = baseExpect.configure({ timeout: 45000 }),
  directory = path.resolve("work/section-notes-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-section-notes-"));
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
    fs.readFileSync("work/section-notes-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Section notes",
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
  const reopen = async (name = "Section notes") => {
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
  const expected = [
    "3",
    "iv",
    "4",
    "v",
    "IX",
    "IX",
    "X",
    "X",
    "b",
    "b",
    "c",
    "c",
    "b",
    "b",
    "c",
    "c",
    "16",
    "16",
    "17",
    "17",
    "VI",
    "XVI",
    "VII",
    "XVII",
  ];
  await expect.poll(labels).toEqual(expected);
  await expect(sheets).toHaveCount(6);
  const editSection = async (anchor) => {
    await editor.locator("p").filter({ hasText: anchor }).click();
    await menu("Section properties…");
    const dialog = page.getByRole("dialog", { name: "Section", exact: true });
    await dialog
      .locator("summary")
      .filter({ hasText: /^Notes$/ })
      .click();
    return dialog;
  };
  let dialog = await editSection("ANCHOR_1_0");
  await dialog
    .locator("summary")
    .filter({ hasText: /^Footnotes$/ })
    .click();
  await dialog
    .getByLabel("Footnotes number format", { exact: true })
    .selectOption("lowerLetter");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  const letters = [...expected];
  letters[4] = "i";
  letters[6] = "j";
  await expect.poll(labels).toEqual(letters);
  await editor.press("Control+z");
  await expect.poll(labels).toEqual(expected);
  dialog = await editSection("ANCHOR_1_0");
  await dialog.getByLabel("Same note settings as previous section").check();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  const inherited = [...expected];
  inherited.splice(4, 4, "5", "vi", "6", "vii");
  await expect.poll(labels).toEqual(inherited);
  await editor.press("Control+z");
  await expect.poll(labels).toEqual(expected);
  dialog = await editSection("ANCHOR_3_0");
  await expect(
    dialog.getByLabel("Same note settings as previous section"),
  ).toBeChecked();
  await dialog.getByLabel("Same note settings as previous section").uncheck();
  await dialog
    .locator("summary")
    .filter({ hasText: /^Footnotes$/ })
    .click();
  await expect(
    dialog.getByLabel("Footnotes number format", { exact: true }),
  ).toHaveValue("lowerLetter");
  await expect(
    dialog.getByLabel("Footnotes start at", { exact: true }),
  ).toHaveValue("2");
  await dialog
    .getByLabel("Footnotes number format", { exact: true })
    .selectOption("decimal");
  await dialog.getByLabel("Footnotes start at", { exact: true }).fill("10");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  const custom = [...expected];
  custom[12] = "10";
  custom[14] = "11";
  await expect.poll(labels).toEqual(custom);
  await editor.press("Control+z");
  await expect.poll(labels).toEqual(expected);
  await editor.press("Control+y");
  await expect.poll(labels).toEqual(custom);
  await editor.press("Control+z");
  await expect.poll(labels).toEqual(expected);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect.poll(labels).toEqual(expected);
  for (const scale of [0.5, 1, 1.5]) {
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
    await expect.poll(labels).toEqual(expected);
    await expect(sheets).toHaveCount(6);
  }
  const positions = await page.evaluate(() =>
    [0, 1, 2, 3, 4, 5].map((index) => {
      const page = document.querySelectorAll(".page-sheets > .page-sheet")[
          index
        ],
        fragment = page.querySelector("[data-footnotes] [data-note-fragment]");
      return {
        pageHeight: page.getBoundingClientRect().height,
        top:
          fragment.getBoundingClientRect().top -
          page.getBoundingClientRect().top,
      };
    }),
  );
  expect(positions[1].top / positions[1].pageHeight).toBeLessThan(0.4);
  for (const index of [0, 2, 3, 4, 5])
    expect(positions[index].top / positions[index].pageHeight).toBeGreaterThan(
      0.7,
    );
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(6);
  await expect(page.locator(".page-card").nth(1)).toContainText("FOOTNOTE_1_0");
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  const pdf = await page.evaluate(async (id) => {
    const r = await window.alder.request("POST", `/api/projects/${id}/export`, {
      format: "pdf",
    });
    return {
      result: r,
      bytes: [
        ...new Uint8Array(
          await (
            await fetch(window.alder.mediaBase + r.downloadUrl)
          ).arrayBuffer(),
        ),
      ],
    };
  }, id);
  expect(pdf.result.validation.pages).toBe(6);
  fs.writeFileSync(path.join(directory, "notes.pdf"), Buffer.from(pdf.bytes));
  await editor
    .locator("p")
    .filter({ hasText: "ANCHOR_1_0" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(directory, "section-notes.png") });
  report.positions = positions;
  report.checks.push(
    "Section formats, inherited settings, native Word continuous counts, per-page overrides, placement, undo/redo, save/reopen, UI scales, Arrangement and PDF",
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
