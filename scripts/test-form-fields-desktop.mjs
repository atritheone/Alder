import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const expect = baseExpect.configure({ timeout: 20000 });
const directory = path.resolve("work/form-fields-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-forms-"));
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
  page.setDefaultTimeout(20000);
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
  const fixture = JSON.parse(
    fs.readFileSync("work/forms-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Form controls",
      template: "blank",
    });
    p.book = fixture.book;
    p.settings = fixture.settings;
    p.styles = fixture.styles;
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
      .filter({ hasText: "Form controls" })
      .first()
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    dialog = page.getByRole("dialog", {
      name: "Form field properties",
      exact: true,
    });
  await expect(editor).toContainText("VALUE_0");
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  const field = (n) => editor.locator(`[data-field-id="field_${n}"]`);
  const apply = async () => {
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  };
  report.stage = "restrictions";
  await field(0).dblclick();
  await expect(dialog.getByLabel("Field text", { exact: true })).toBeDisabled();
  await dialog.getByLabel("Lock content", { exact: true }).uncheck();
  await dialog.getByLabel("Field text", { exact: true }).fill("FORM_CHANGED");
  await apply();
  await expect(field(0)).toHaveText("FORM_CHANGED");
  await editor.press("Control+z");
  await expect(field(0)).toHaveText("VALUE_0");
  await editor.press("Control+y");
  await expect(field(0)).toHaveText("FORM_CHANGED");
  await field(0).click();
  await page.keyboard.press("Delete");
  await expect(field(0)).toHaveCount(1);
  await expect(
    page.getByText(/is locked\. Change its restrictions/),
  ).toBeVisible();
  report.stage = "rich text";
  await field(1).dblclick();
  const rich = dialog.getByRole("textbox", { name: "Field text", exact: true });
  await rich.click();
  await rich.press("Control+Home");
  await rich.press("Control+Shift+End");
  await rich.type("CANCELLED_EDIT");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(field(1)).toContainText("RICH_ALPHA");
  await field(1).dblclick();
  await rich.click();
  await rich.press("Control+Home");
  await rich.press("Control+Shift+End");
  await rich.type("FORM_RICH");
  await rich.press("Control+Home");
  await rich.press("Control+Shift+End");
  await dialog.getByRole("button", { name: "Bold", exact: true }).click();
  await apply();
  await expect(field(1)).toHaveText("FORM_RICH");
  report.stage = "checkbox date";
  await field(2).dblclick();
  await dialog.getByLabel("Checked", { exact: true }).uncheck();
  await apply();
  await expect(field(2)).toHaveText("\u2610");
  await field(2).click();
  await page.keyboard.press("Space");
  await expect(field(2)).toHaveText("\u2612");
  await editor.press("Control+z");
  await expect(field(2)).toHaveText("\u2610");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await dialog.getByLabel("Field date", { exact: true }).fill("2028-02-29");
  await apply();
  await expect(field(3)).toHaveText("2028-02-29");
  report.stage = "insertion clipboard";
  await editor.press("Control+End");
  await editor.press("Enter");
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Insert form field…", exact: true })
    .click();
  await dialog.getByLabel("Field name", { exact: true }).fill("New field");
  await dialog.getByLabel("Field text", { exact: true }).fill("FORM_INSERTED");
  await apply();
  await expect(editor.locator("[data-form-field]")).toHaveCount(7);
  await editor.press("Control+z");
  await expect(editor.locator("[data-form-field]")).toHaveCount(6);
  await editor.press("Control+y");
  await expect(editor.locator("[data-form-field]")).toHaveCount(7);
  const html = await field(0).evaluate(
    (el) => "<strong>" + el.outerHTML + "</strong>",
  );
  await editor.press("Control+End");
  await editor.press("Enter");
  await editor.evaluate((el, html) => {
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData("text/plain", "FORM_CHANGED");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, html);
  await expect(editor.locator("[data-form-field]")).toHaveCount(8);
  const ids = await editor
    .locator("[data-form-field]")
    .evaluateAll((els) => els.map((el) => el.dataset.fieldId));
  expect(new Set(ids).size).toBe(8);
  await editor.press("Control+z");
  await expect(editor.locator("[data-form-field]")).toHaveCount(7);
  report.stage = "scales";
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
    await field(0).dblclick();
    await expect(dialog.getByLabel("Field text", { exact: true })).toHaveValue(
      "FORM_CHANGED",
    );
    const fit = await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.top >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1
      );
    });
    expect(fit).toBe(true);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(editor.locator("[data-form-field]")).toHaveCount(7);
  await expect(field(0)).toHaveText("FORM_CHANGED");
  report.stage = "arrangement export";
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card").first()).toBeVisible();
  await expect(page.locator(".page-snapshot [data-form-field]")).toHaveCount(7);
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const result = await page.evaluate(async (id) => {
    const project = await window.alder.request("GET", `/api/projects/${id}`),
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
    return {
      project,
      files,
      after: await window.alder.request("GET", `/api/projects/${id}`),
    };
  }, id);
  expect(result.after.book).toEqual(result.project.book);
  for (const format of ["docx", "pdf"])
    fs.writeFileSync(
      path.join(directory, "forms." + format),
      Buffer.from(result.files[format]),
    );
  fs.writeFileSync(
    path.join(directory, "project.json"),
    JSON.stringify(result.project),
  );
  const loading = getDocument({ data: new Uint8Array(result.files.pdf) }),
    pdf = await loading.promise;
  let wording = "";
  for (let n = 1; n <= pdf.numPages; n++)
    wording += (await (await pdf.getPage(n)).getTextContent()).items
      .map((i) => i.str)
      .join(" ");
  for (const word of [
    "FORM_CHANGED",
    "FORM_RICH",
    "FORM_INSERTED",
    "2028-02-29",
  ])
    expect(wording.split(word).length - 1).toBe(1);
  expect(wording).not.toContain("FIELD_4");
  expect(wording).not.toContain("FIELD_5");
  report.pages = pdf.numPages;
  await loading.destroy();
  await page.screenshot({ path: path.join(directory, "forms.png") });
  expect(report.errors).toEqual([]);
  report.status = "passed";
  report.checks.push(
    "Insertion and local editing/cancel; lock enforcement and deliberate unlock; dates/checkboxes; undo/redo; clipboard identity; 50/100/150% UI; save/reopen; Arrangement; native DOCX and measured PDF values without prompts; source unchanged",
  );
} catch (e) {
  report.status = "failed";
  report.error = e.stack;
  await page
    ?.screenshot({ path: path.join(directory, "failure.png"), timeout: 5000 })
    .catch(() => {});
  throw e;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
