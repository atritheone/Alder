import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const expect = baseExpect.configure({ timeout: 30000 }),
  directory = path.resolve(process.argv.includes("--pages")?"work/shapes-pages-ui":"work/shapes-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-shapes-"));
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
  await page.getByRole("button", { name: "New", exact: true }).click();
  const newDialog = page.getByRole("dialog", { name: "New document" });
  await newDialog.getByRole("button", { name: "Word document .docx" }).click();
  await newDialog.locator("input[name=name]").fill("Shape qualification");
  await newDialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(newDialog).not.toBeVisible();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });

  const kinds = ["rectangle", "triangle", "diamond", "line", "arrow"];
  const properties = page.getByRole("dialog", { name: "Shape properties" });
  const tools = page.locator(".book-workspace .format-toolbar");
  const show = async (toolbar = page) => {
    await toolbar
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Insert shape…", exact: true })
      .click();
    await expect(properties).toBeVisible();
  };
  for (const [i, kind] of kinds.entries()) {
    report.stage = `insert ${kind}`;
    await editor.press("Control+End");
    if (i) await editor.press("Enter");
    await editor.pressSequentially(`SHAPE_${i} before `);
    await show();
    await properties.getByLabel("Shape kind").selectOption(kind);
    if(process.argv.includes("--pages"))await properties.getByLabel("Shape height",{exact:true}).fill("70");
    await properties.getByLabel("Shape description").fill(`${kind} diagram`);
    if(kind === "arrow")await properties.getByLabel("Decorative",{exact:true}).check();
    if(kind !== "line") await properties.getByLabel("Shape fill colour").fill("#c9d8e8");
    await properties
      .getByRole("button", { name: "Apply", exact: true })
      .click();
    await expect(properties).not.toBeVisible();
    await expect(editor.locator("[data-document-shape]")).toHaveCount(i + 1);
    await editor.press("Control+z");
    await expect(editor.locator("[data-document-shape]")).toHaveCount(i);
    await editor.press("Control+y");
    await expect(editor.locator("[data-document-shape]")).toHaveCount(i + 1);
    await editor.press("ArrowRight");
    await editor.pressSequentially(" after.");
  }
  report.stage = "edit and clipboard";
  const first = editor.locator("[data-document-shape]").first();
  const original = JSON.parse(await first.getAttribute("data-document-shape"));
  await first.dblclick();
  await properties.getByLabel("Shape width", { exact: true }).fill("60");
  await properties
    .getByLabel("Shape description")
    .fill("Edited rectangle diagram");
  await page.screenshot({ path: path.join(directory, "properties.png") });
  await properties.getByRole("button", { name: "Apply", exact: true }).click();
  const changed = JSON.parse(await first.getAttribute("data-document-shape"));
  if (
    changed.blockId !== original.blockId ||
    Math.abs(changed.width - (60 * 96) / 25.4) > 0.01
  )
    throw Error("Shape edit lost size or identity");
  await editor.press("Control+z");
  await expect(first).toHaveAttribute("aria-label", "rectangle diagram");
  await editor.press("Control+y");
  await expect(first).toHaveAttribute("aria-label", "Edited rectangle diagram");
  await editor.press("Enter");
  await expect(properties).toBeVisible();
  await properties.getByRole("button", { name: "Cancel", exact: true }).click();
  const html = await first.evaluate((el) => el.outerHTML);
  await editor.press("Control+End");
  await editor.press("Enter");
  await editor.evaluate((el, html) => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", html);
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, html);
  await expect(editor.locator("[data-document-shape]")).toHaveCount(6);
  const ids = await editor
    .locator("[data-shape-id]")
    .evaluateAll((els) => els.map((el) => el.dataset.shapeId));
  if (new Set(ids).size !== 6) throw Error("Copy reused an object identity");
  await editor.press("ArrowRight");
  await editor.pressSequentially(" AFTER_COPY");
  await expect(editor).toContainText("AFTER_COPY");
  for (const scale of ["0.5", "1.5", "1"]) {
    report.stage = `UI scale ${scale}`;
    await page.keyboard.press("Control+,");
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await settings
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await settings.getByLabel("UI Scale", { exact: true }).selectOption(scale);
    await settings
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
    await first.dblclick();
    await expect(properties).toBeVisible();
    const fits = await properties.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.left >= 0 &&
        r.top >= 0 &&
        r.right <= innerWidth + 1 &&
        r.bottom <= innerHeight + 1
      );
    });
    if (!fits) throw Error(`Shape dialog overflow at ${scale}`);
    await properties
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
  }
  report.stage = "sandbox";
  const toggle = page.getByRole("button", {
    name: "Toggle sandbox",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
  const sandbox = page.getByRole("textbox", {
    name: "Sandbox text editor",
    exact: true,
  });
  await sandbox.fill("Draft only");
  await sandbox.press("Control+End");
  await show(page.locator(".detail-pane .format-toolbar"));
  await properties.getByLabel("Shape kind").selectOption("diamond");
  await properties.getByLabel("Shape description").fill("Sandbox diagram");
  await properties.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(sandbox.locator("[data-document-shape]")).toHaveCount(1);
  await expect(editor.locator("[data-document-shape]")).toHaveCount(6);
  await toggle.click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const project = await page.evaluate(async () => {
    const p = (
      await window.alder.request("GET", "/api/projects")
    ).projects.find((p) => p.name === "Shape qualification");
    return window.alder.request("GET", `/api/projects/${p.id}`);
  });
  fs.writeFileSync(
    path.join(directory, "fixture-project.json"),
    JSON.stringify(project, null, 2),
  );
  report.stage = "reopen";
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Shape qualification" })
    .click();
  await expect(editor.locator("[data-document-shape]")).toHaveCount(6);
  await page.screenshot({ path: path.join(directory, "write.png") });
  const outputs = {};
  await app.evaluate(({ app }) =>
    app.on("web-contents-created", (_event, wc) => {
      const print = wc.printToPDF.bind(wc);
      wc.printToPDF = async (...args) => {
        global.__shapePublication = await wc.executeJavaScript(
          "document.documentElement.outerHTML",
        );
        return print(...args);
      };
    }),
  );
  for (const format of ["docx", "pdf", "html", "epub"]) {
    report.stage = `export ${format}`;
    const result = await page.evaluate(
      async ({ id, format }) => {
        const result = await window.alder.request(
          "POST",
          `/api/projects/${id}/export`,
          { format },
        );
        const response = await fetch(
          window.alder.mediaBase + result.downloadUrl,
        );
        return {
          result,
          bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
        };
      },
      { id: project.id, format },
    );
    const file = path.join(directory, `alder.${format}`);
    fs.writeFileSync(file, Buffer.from(result.bytes));
    outputs[format] = { ...result.result, path: file };
  }
  Object.assign(outputs, {
    expectedText: kinds.map((_, i) => `SHAPE_${i}`),
    skipListNumbers: true,
  });
  fs.writeFileSync(
    path.join(directory, "fixture-exports.json"),
    JSON.stringify(outputs, null, 2),
  );
  const printed = await app.evaluate(() => global.__shapePublication);
  if (printed)
    fs.writeFileSync(path.join(directory, "publication.html"), printed);
  report.stage = "arrangement";
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect.poll(()=>page.locator(".page-card [data-document-shape]").evaluateAll(nodes=>nodes.filter(el=>el.style.visibility!=="hidden").length)).toBe(6);
  report.pages=await page.locator(".page-card").count();
  if(process.argv.includes("--pages")&&report.pages<2)throw Error("Expected multi-page shape flow");
  await page.screenshot({ path: path.join(directory, "arrangement.png") });
  report.stage = "overflow";
  const oversized = structuredClone(project);
  oversized.book.chapters[0].document.content[0].content.find(
    (n) => n.type === "shape",
  ).attrs.width = 2000;
  const stored = await page.evaluate(
    (p) =>
      window.alder.request("PUT", `/api/projects/${p.id}`, {
        project: p,
        expectedRevision: p.revision,
      }),
    oversized,
  );
  for (const format of ["pdf", "docx"]) {
    const error = await page.evaluate(
      async ({ id, format }) => {
        try {
          await window.alder.request("POST", `/api/projects/${id}/export`, {
            format,
          });
          return "";
        } catch (e) {
          return e.message;
        }
      },
      { id: project.id, format },
    );
    if (!error.includes("shape is too large"))
      throw Error(`Expected ${format} overflow refusal: ${error}`);
  }
  await page.evaluate(
    ({ p, revision }) =>
      window.alder.request("PUT", `/api/projects/${p.id}`, {
        project: p,
        expectedRevision: revision,
      }),
    { p: project, revision: stored.revision },
  );
  if (report.errors.length) throw Error(report.errors.join("\n"));
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.error = e.stack || String(e);
  process.exitCode = 1;
  if (page)
    await page
      .screenshot({ path: path.join(directory, "failure.png") })
      .catch(() => {});
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  if (app) await app.close().catch(() => {});
}
