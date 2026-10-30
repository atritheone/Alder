import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const expect = baseExpect.configure({ timeout: 30000 }),
  directory = path.resolve("work/kept-notes-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-kept-notes-"));
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
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("dialog", async (d) => {
    if (d.type() === "beforeunload") await d.accept().catch(() => {});
    else {
      report.errors.push(d.message());
      await d.dismiss().catch(() => {});
    }
  });
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  const fixture = JSON.parse(
    fs.readFileSync(path.join(directory, "fixture-project.json"), "utf8"),
  );
  const id = await page.evaluate(async (f) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: f.name,
      template: "blank",
    });
    p.book = f.book;
    p.styles = f.styles;
    p.settings = f.settings;
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
      .filter({ hasText: "Kept note rows" })
      .click();
  };
  await reopen();
  const sheets = page.locator(".page-sheets"),
    editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    });
  await expect(sheets).toContainText("END069");
  await expect(sheets).toContainText("FOOT069");
  const pageCount = await sheets.locator(".page-sheet").count();
  expect(pageCount).toBeGreaterThan(3);
  report.pages = pageCount;
  const verify = async () => {
    const result = await sheets.evaluate((root) => {
      const text = root.textContent,
        errors = [];
      for (const prefix of ["FOOT", "END"])
        for (let i = 0; i < 70; i++) {
          const marker = prefix + String(i).padStart(3, "0");
          if (text.split(marker).length !== 2) errors.push(marker);
        }
      for (const span of root.querySelectorAll("[data-note-from]")) {
        const a = span.getBoundingClientRect(),
          b = span.closest(".page-sheet").getBoundingClientRect();
        if (a.top < b.top - 1 || a.bottom > b.bottom + 1)
          errors.push("Outside " + span.textContent);
      }
      return errors;
    });
    expect(result).toEqual([]);
  };
  await verify();
  // Editing a continuation uses the local note editor, and document undo retains it.
  await editor.locator("[data-note-id]").first().dblclick();
  const dialog = page.getByRole("dialog", { name: "Notes", exact: true }),
    body = dialog.getByRole("textbox", { name: "Note text", exact: true });
  await body.locator("p").filter({ hasText: "FOOT069" }).click();
  await body.press("End");
  await body.type(" CHANGED");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(sheets).toContainText("CHANGED");
  await editor.press("Control+z");
  await expect(sheets).not.toContainText("CHANGED");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(sheets).toContainText("FOOT069");
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
    await expect(sheets.locator(".page-sheet")).toHaveCount(pageCount);
    await verify();
  }
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(pageCount);
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  const output = await page.evaluate(async (id) => {
    const before = await window.alder.request("GET", `/api/projects/${id}`),
      files = {},
      reports = {};
    for (const format of ["docx", "pdf"]) {
      const result = await window.alder.request(
        "POST",
        `/api/projects/${id}/export`,
        { format },
      );
      reports[format] = result;
      files[format] = [
        ...new Uint8Array(
          await (
            await fetch(window.alder.mediaBase + result.downloadUrl)
          ).arrayBuffer(),
        ),
      ];
    }
    return {
      before,
      after: await window.alder.request("GET", `/api/projects/${id}`),
      files,
      reports,
    };
  }, id);
  expect(output.after).toEqual(output.before);
  expect(
    output.reports.docx.warnings.some((w) =>
      w.includes("row taller than a page"),
    ),
  ).toBe(true);
  for (const format of ["docx", "pdf"])
    fs.writeFileSync(
      path.join(directory, "notes." + format),
      Buffer.from(output.files[format]),
    );
  fs.writeFileSync(
    path.join(directory, "fixture-exports.json"),
    JSON.stringify({
      docx: { path: path.join(directory, "notes.docx") },
      footnotesExpected: 1,
      endnotesExpected: 1,
      skipListNumbers: true,
      expectedText: ["NOTE BODY", "END BODY"],
    }),
  );
  await editor.press("Control+Home");
  await page.screenshot({ path: path.join(directory, "kept-notes.png") });
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
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
