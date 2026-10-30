import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const expect = baseExpect.configure({ timeout: 45000 }),
  directory = path.resolve(
    process.env.ALDER_MERGED_REPORT || "work/merged-table-ui",
  ),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-merged-table-"));
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
    fs.readFileSync(
      `${process.env.ALDER_MERGED_FIXTURE || "work/merged-table-word"}/fixture-project.json`,
      "utf8",
    ),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Merged table",
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
  const reopen = async (name = "Merged table") => {
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
  const tableCount = (node) =>
    Number(node.type === "table") +
    (node.content || []).reduce((sum, child) => sum + tableCount(child), 0);
  await expect(editor.locator("table")).toHaveCount(
    tableCount(fixture.book.chapters[0].document),
  );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  report.geometry = await editor.evaluate((root) => {
    const pages = [
      ...document.querySelectorAll(".page-sheets > .page-sheet"),
    ].map((page) => page.getBoundingClientRect());
    return [...root.querySelectorAll("table p")].map((p) => {
      const rect = p.getBoundingClientRect(),
        index = pages.findIndex(
          (page) => rect.top >= page.top && rect.bottom <= page.bottom,
        );
      return {
        text: p.textContent,
        page: index,
        top:
          index < 0 ? -1 : (rect.top - pages[index].top) / pages[index].height,
        bottom:
          index < 0
            ? -1
            : (rect.bottom - pages[index].top) / pages[index].height,
      };
    });
  });
  report.pages = await sheets.count();
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
  fs.writeFileSync(path.join(directory, "table.pdf"), Buffer.from(pdf.bytes));
  report.pdf = pdf.result.validation;
  await page.screenshot({ path: path.join(directory, "table.png") });
  expect(report.errors).toEqual([]);
  report.status = "measured";
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
