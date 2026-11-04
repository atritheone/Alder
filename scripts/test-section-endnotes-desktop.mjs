import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const expect = baseExpect.configure({ timeout: 20000 }),
  variant = process.argv.includes("--columns")
    ? "columns"
    : process.argv.includes("--continuous")
      ? "continuous"
      : "pages";
const directory = path.resolve(`work/section-endnotes-${variant}-ui`),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-endnotes-"));
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
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const fixture = JSON.parse(
    fs.readFileSync(
      `work/section-endnotes${variant === "pages" ? "" : "-" + variant}-word/fixture-project.json`,
      "utf8",
    ),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: fixture.name,
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
  const reopen = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: fixture.name })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    sheets = page.locator(".page-sheets > .page-sheet");
  await expect(
    sheets.locator('[data-note-fragment="note0"]').last(),
  ).toContainText("NOTE_0_089");
  const inspect = () =>
    page.evaluate(() => {
      const sheets = [
          ...document.querySelectorAll(".page-sheets > .page-sheet"),
        ],
        editor = document.querySelector('.ProseMirror[contenteditable="true"]');
      const fragments = sheets.flatMap((sheet, index) =>
        [...sheet.querySelectorAll("[data-note-fragment]")].map((n) => {
          const r = n.getBoundingClientRect(),
            p = sheet.getBoundingClientRect();
          return {
            id: n.dataset.noteFragment,
            text: n.textContent,
            page: index,
            top: r.top,
            bottom: r.bottom,
            inBounds:
              r.top >= p.top - 1 &&
              r.bottom <= p.bottom + 1 &&
              r.left >= p.left - 1 &&
              r.right <= p.right + 1,
          };
        }),
      );
      const bodies = [0, 1, 2].map(
        (i) =>
          [...editor.querySelectorAll("p")]
            .find((p) => p.textContent.includes("BODY_" + i))
            ?.getBoundingClientRect().top,
      );
      return { pages: sheets.length, fragments, bodies };
    });
  report.layout = await inspect();
  if (variant === "columns") expect(report.layout.pages).toBeLessThanOrEqual(4);
  for (let section = 0; section < 3; section++) {
    const rows = report.layout.fragments.filter(
        (n) => n.id === "note" + section,
      ),
      text = rows.map((n) => n.text).join(" ");
    for (let i = 0; i < (section === 0 ? 90 : 2); i++)
      expect(
        text.match(
          new RegExp(`NOTE_${section}_${String(i).padStart(3, "0")}`, "g"),
        )?.length,
      ).toBe(1);
    expect(rows.every((n) => n.inBounds)).toBe(true);
    if (section < 2)
      expect(Math.max(...rows.map((n) => n.bottom))).toBeLessThan(
        report.layout.bodies[section + 1],
      );
  }
  await editor.locator("p").filter({ hasText: "BODY_1" }).click();
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Section properties…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Section", exact: true });
  await dialog
    .locator("summary")
    .filter({ hasText: /^Notes$/ })
    .click();
  await dialog.getByLabel("Same note settings as previous section").uncheck();
  await dialog
    .locator("summary")
    .filter({ hasText: /^Endnotes$/ })
    .click();
  await expect(
    dialog.getByLabel("Endnotes placement", { exact: true }),
  ).toHaveValue("sectEnd");
  await dialog
    .getByLabel("Endnotes placement", { exact: true })
    .selectOption("docEnd");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(async () => {
      const r = await inspect();
      return r.fragments.find((n) => n.id === "note1")?.top > r.bodies[2];
    })
    .toBe(true);
  await editor.press("Control+z");
  await expect
    .poll(async () => {
      const r = await inspect();
      return r.fragments.find((n) => n.id === "note1")?.top < r.bodies[2];
    })
    .toBe(true);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(
    sheets.locator('[data-note-fragment="note0"]').last(),
  ).toContainText("NOTE_0_089");
  for (const scale of [0.5, 1, 1.5]) {
    await page.keyboard.press("Control+,");
    const settings=page.getByRole("dialog",{name:"Settings",exact:true});
    await settings.getByRole("tab",{name:"Appearance",exact:true}).click();
    await settings.getByLabel("UI Scale",{exact:true}).selectOption(String(scale));
    await settings.getByRole("button",{name:"Done",exact:true}).click();
    await expect(sheets).toHaveCount(report.layout.pages);
  }
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
  fs.writeFileSync(path.join(directory, "notes.pdf"), Buffer.from(pdf.bytes));
  report.export = pdf.result;
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(report.layout.pages);
  await page.screenshot({ path: path.join(directory, "section-endnotes.png") });
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
