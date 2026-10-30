import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const expect = baseExpect.configure({ timeout: 30000 }),
  directory = path.resolve("work/form-blocks-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-form-blocks-"));
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
  const fixture = JSON.parse(
    fs.readFileSync("work/forms-block-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Rich form",
      template: "blank",
    });
    p.book = fixture.book;
    p.settings = fixture.settings;
    p.styles = fixture.styles;
    p.assets = fixture.assets;
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
      .filter({ hasText: "Rich form" })
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
    }),
    field = editor.locator('[data-field-id="block_form"]');
  await expect(field).toContainText("BLOCK_FLOW_039");
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  report.stage = "block properties";
  await field.locator("p").first().dblclick();
  await expect(
    dialog.getByLabel("Lock content", { exact: true }),
  ).toBeChecked();
  await dialog.getByLabel("Lock content", { exact: true }).uncheck();
  const local = dialog.getByRole("textbox", {
    name: "Field text",
    exact: true,
  });
  await expect(local.locator("table")).toHaveCount(1);
  await expect(local.locator("ol")).toHaveCount(1);
  await expect(local.locator("img:not(.ProseMirror-separator)")).toHaveCount(1);
  await local.click();
  await local.press("Control+Home");
  await local.type("FORM_BLOCK_EDIT ");
  await local.press("Control+z");
  await expect(local).not.toContainText("FORM_BLOCK_EDIT");
  await local.press("Control+y");
  await expect(local).toContainText("FORM_BLOCK_EDIT");
  const imageHTML=await local.locator("img:not(.ProseMirror-separator)").evaluate(el=>el.outerHTML);
  await local.press("Control+End");
  await local.evaluate((el,imageHTML)=>{
    const data=new DataTransfer();
    data.setData("text/html",`<p><strong>FORM_PASTE</strong>${imageHTML}<img src="https://example.invalid/external.png" alt="EXTERNAL_ALTERNATIVE"></p>`);
    data.setData("text/plain","FORM_PASTE");
    el.dispatchEvent(new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true}));
  },imageHTML);
  await expect(local.locator("img:not(.ProseMirror-separator)")).toHaveCount(2);
  await expect(local.locator("strong")).toContainText("FORM_PASTE");
  await expect(local).toContainText("EXTERNAL_ALTERNATIVE");
  await expect(local.locator('img[src^="https:"]')).toHaveCount(0);
  await local.press("Control+z");
  await expect(local.locator("img:not(.ProseMirror-separator)")).toHaveCount(1);
  await expect(local).not.toContainText("FORM_PASTE");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(field).toContainText("FORM_BLOCK_EDIT");
  await editor.press("Control+z");
  await expect(field).not.toContainText("FORM_BLOCK_EDIT");
  await editor.press("Control+y");
  await expect(field).toContainText("FORM_BLOCK_EDIT");
  report.stage = "new block";
  await editor.press("Control+End");
  await editor.press("Enter");
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Insert form field…", exact: true })
    .click();
  await dialog
    .getByLabel("Field type", { exact: true })
    .selectOption("richBlock");
  await dialog.getByLabel("Field name", { exact: true }).fill("New block");
  await local.click();
  await local.type("NEW_BLOCK_ONE");
  await local.press("Enter");
  await local.type("NEW_BLOCK_TWO");
  await dialog.getByLabel("Lock content", { exact: true }).check();
  await dialog.getByLabel("Prevent deletion", { exact: true }).check();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editor.locator(".form-block")).toHaveCount(2);
  await expect(editor.locator(".form-block").last().locator("p")).toHaveCount(
    2,
  );
  await editor.press("Control+z");
  await expect(editor.locator(".form-block")).toHaveCount(1);
  await editor.press("Control+y");
  await expect(editor.locator(".form-block")).toHaveCount(2);
  report.stage = "scales and reopen";
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
    await field.locator("p").first().dblclick();
    await expect(local).toContainText("BLOCK_FLOW_039");
    expect(
      await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.top >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1
        );
      }),
    ).toBe(true);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(editor.locator(".form-block")).toHaveCount(2);
  await expect(field).toContainText("FORM_BLOCK_EDIT");
  report.stage = "arrangement";
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card").first()).toBeVisible();
  expect(await page.locator(".page-card").count()).toBeGreaterThan(1);
  const failures = await page.evaluate(() => {
    const root = document.querySelector(".book-editor .ProseMirror"),
      canvas = root.closest(".flow-canvas"),
      width = parseFloat(canvas.style.width),
      origin = canvas.getBoundingClientRect(),
      scale = origin.width / width,
      pitch = parseFloat(canvas.style.getPropertyValue("--page-height")) + 28;
    const sources = [
        ...root.querySelectorAll('[data-field-id="block_form"] p'),
      ],
      failures = [];
    document.querySelectorAll(".page-card").forEach((card, index) => {
      const sheet = card.querySelector(".page-snapshot"),
        box = sheet.getBoundingClientRect(),
        ratio = box.width / width;
      for (const copy of sheet.querySelectorAll(
        '[data-field-id="block_form"] p',
      )) {
        const source = sources.find((p) => p.textContent === copy.textContent);
        if (!source) continue;
        const a = source.getBoundingClientRect(),
          b = copy.getBoundingClientRect();
        const expected = (a.top - origin.top) / scale - index * pitch,
          actual = (b.top - box.top) / ratio;
        if (Math.abs(expected - actual) > 2)
          failures.push({
            text: copy.textContent.slice(0, 30),
            expected,
            actual,
          });
      }
    });
    return failures;
  });
  expect(failures).toEqual([]);
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  report.stage = "exports";
  const result = await page.evaluate(async (id) => {
    const project = await window.alder.request("GET", `/api/projects/${id}`),
      files = {};
    for (const format of ["docx", "pdf"]) {
      const output = await window.alder.request(
        "POST",
        `/api/projects/${id}/export`,
        { format },
      );
      files[format] = [
        ...new Uint8Array(
          await (
            await fetch(window.alder.mediaBase + output.downloadUrl)
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
  let text = "";
  for (let n = 1; n <= pdf.numPages; n++)
    text += (await (await pdf.getPage(n)).getTextContent()).items
      .map((i) => i.str)
      .join(" ");
  for (const marker of [
    ...Array.from(
      { length: 40 },
      (_, i) => `BLOCK_FLOW_${String(i).padStart(3, "0")}`,
    ),
    "FORM_BLOCK_EDIT",
    "BLOCK_ALPHA",
    "BLOCK_LIST_ONE",
    "BLOCK_LIST_TWO",
    "BLOCK_CELL_ONE",
    "BLOCK_CELL_TWO",
    "BLOCK_OMEGA",
    "AFTER_FORM",
    "NEW_BLOCK_ONE",
    "NEW_BLOCK_TWO",
  ])
    expect(text.split(marker).length - 1).toBe(1);
  report.pages = pdf.numPages;
  await loading.destroy();
  await page.screenshot({ path: path.join(directory, "forms.png") });
  expect(report.errors).toEqual([]);
  report.status = "passed";
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
