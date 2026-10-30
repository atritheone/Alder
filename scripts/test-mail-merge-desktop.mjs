import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const expect = baseExpect.configure({ timeout: 30000 }),
  directory = path.resolve("work/mail-merge-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-merge-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", errors: [], checks: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "beforeunload") await dialog.accept().catch(() => {});
    else {
      report.errors.push(dialog.message());
      await dialog.dismiss().catch(() => {});
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
    fs.readFileSync("work/mail-merge-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Merge letter",
      template: "blank",
    });
    p.book = fixture.book;
    p.styles = fixture.styles;
    p.settings = fixture.settings;
    await window.alder.request("PUT", `/api/projects/${p.id}`, {
      project: p,
      expectedRevision: p.revision,
    });
    return p.id;
  }, fixture);
  const reopen = async (name) => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: name })
      .first()
      .click();
  };
  await reopen("Merge letter");
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    dialog = page.getByRole("dialog", { name: "Mail merge", exact: true });
  const menu = async () => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Mail merge…", exact: true })
      .click();
    await expect(dialog).toBeVisible();
  };
  await expect(editor).toContainText("Dear");
  // Real insertion, ordinary undo and saved field identity.
  await editor.press("Control+End");
  await editor.press("Enter");
  await menu();
  await dialog.getByLabel("Merge field name", { exact: true }).fill("Code");
  await dialog
    .getByRole("button", { name: "Insert field", exact: true })
    .click();
  await expect(editor.locator('[data-merge-key="Code"]')).toHaveCount(1);
  await editor.press("Control+z");
  await expect(editor.locator('[data-merge-key="Code"]')).toHaveCount(0);
  await editor.press("Control+y");
  await expect(editor.locator('[data-merge-key="Code"]')).toHaveCount(1);
  await expect(page.locator(".save-status")).toHaveText("Saved");
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
      dialog.getByRole("button", { name: "Choose CSV…", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await menu();
  const before = await page.evaluate(
    (id) => window.alder.request("GET", `/api/projects/${id}`),
    id,
  );
  await dialog
    .getByLabel("Mail merge CSV", { exact: true })
    .setInputFiles({
      name: "invalid.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("A,A\n1,2"),
    });
  await expect(dialog.getByRole("alert")).toContainText("unique");
  const csv =
    'Full name,Address,Account,Code\r\n"A & B <literal>","First line\r\nSecond line",00123,ALPHA\r\nSkipped,Other,00002,BETA\r\nThai \u0e44\u0e17\u0e22 \u{1f600},,=2+3,GAMMA\r\n';
  await dialog
    .getByLabel("Mail merge CSV", { exact: true })
    .setInputFiles({
      name: "recipients.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  await expect(
    dialog.getByLabel("Column for Name", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("Column for Name", { exact: true })
    .selectOption("Full name");
  await dialog.getByLabel("Merge records", { exact: true }).fill("1,3");
  const preview = dialog.getByLabel("Merge preview", { exact: true });
  await expect(preview).toContainText("A & B <literal>");
  await expect(preview).toContainText("Second line");
  await expect(preview).toContainText("00123");
  await expect(
    preview.locator("strong").filter({ hasText: "A & B <literal>" }),
  ).toHaveCount(1);
  await dialog.getByLabel("Preview record", { exact: true }).fill("3");
  await expect(preview).toContainText("Thai");
  await expect(preview).toContainText("=2+3");
  await page.screenshot({ path: path.join(directory, "merge.png") });
  await dialog
    .getByRole("button", { name: "Create documents", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Created 2 documents");
  expect(
    await page.evaluate(
      (id) => window.alder.request("GET", `/api/projects/${id}`),
      id,
    ),
  ).toEqual(before);
  const list = await page.evaluate(() =>
    window.alder.request("GET", "/api/projects"),
  );
  expect(
    list.projects.filter((p) => p.name.startsWith("Merge letter - ")),
  ).toHaveLength(2);
  await dialog
    .getByRole("button", { name: "Merge letter - 1", exact: true })
    .click();
  await expect(editor).toContainText("A & B <literal>");
  await expect(editor.locator("[data-merge-key]")).toHaveCount(0);
  await editor.press("Control+End");
  await editor.press("End");
  await editor.type(" EDITABLE");
  await editor.press("Control+z");
  await expect(editor).not.toContainText("EDITABLE");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const created = list.projects.find((p) => p.name === "Merge letter - 1");
  const result = await page.evaluate(async (id) => {
    const p = await window.alder.request("GET", `/api/projects/${id}`),
      files = {};
    for (const format of ["docx", "pdf"]) {
      const file = await window.alder.request(
        "POST",
        `/api/projects/${id}/export`,
        { format },
      );
      files[format] = [
        ...new Uint8Array(
          await (
            await fetch(window.alder.mediaBase + file.downloadUrl)
          ).arrayBuffer(),
        ),
      ];
    }
    return { project: p, files };
  }, created.id);
  for (const format of ["docx", "pdf"])
    fs.writeFileSync(
      path.join(directory, "merged." + format),
      Buffer.from(result.files[format]),
    );
  fs.writeFileSync(
    path.join(directory, "project.json"),
    JSON.stringify(result.project),
  );
  await reopen("Merge letter - 1");
  await expect(editor).toContainText("ALPHA");
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card").first()).toBeVisible();
  report.checks.push(
    "Field insertion and undo/redo; 50/100/150% UI; CSV validation, mapping, exact records, literal Unicode/empty/multiline values, formatting preview; source unchanged; independent persisted documents; DOCX/PDF; Arrangement",
  );
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
