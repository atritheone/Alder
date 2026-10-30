import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const expect = baseExpect.configure({ timeout: 30000 }),
  directory = path.resolve("work/stationery-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-stock-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", errors: [], stocks: [] };
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
  const stocks = JSON.parse(
    fs.readFileSync("backend/alder/stationery-presets.json", "utf8"),
  );
  for (const [index, stock] of stocks.entries()) {
    report.stage = stock.id;
    if (index) await page.keyboard.press("Control+n");
    else await page.getByRole("button", { name: "New", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New document" });
    await dialog.getByRole("button", { name: "Word document .docx" }).click();
    await dialog
      .getByLabel("Document template")
      .selectOption(`stock:${stock.id}`);
    await dialog.locator("input[name=name]").fill(stock.id);
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    });
    await expect(editor.locator("table")).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.unmaximize();
      w.setSize(1440, 1000);
      w.show();
      w.focus();
    });
    let project = await page.evaluate(
      async (name) =>
        (await window.alder.request("GET", "/api/projects")).projects.find(
          (p) => p.name === name,
        ),
      stock.id,
    );
    const id = project.id;
    project = await page.evaluate(
      (id) => window.alder.request("GET", `/api/projects/${id}`),
      id,
    );
    if (project.settings.stationeryPreset !== stock.id)
      throw Error("Stock setting was not retained");
    // Fill every address in the same saved document; editor interaction follows.
    let markers = [];
    const fill = (n) => {
      if (n.type === "form_field") {
        const marker = `ADDR_${stock.id.replaceAll("-", "_")}_${String(markers.length).padStart(3, "0")}`;
        markers.push(marker);
        n.content = [
          { type: "text", text: marker },
          { type: "hard_break" },
          { type: "text", text: "42 Garden Street" },
          { type: "hard_break" },
          { type: "text", text: "Sydney NSW 2000" },
        ];
      }
      n.content?.forEach(fill);
    };
    fill(project.book.chapters[0].document);
    await page.evaluate(
      (p) =>
        window.alder.request("PUT", `/api/projects/${p.id}`, {
          project: p,
          expectedRevision: p.revision,
        }),
      project,
    );
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: stock.id })
      .click();
    await expect(editor.locator("table")).toBeVisible();
    await expect(editor).toContainText(markers[0]);
    await editor.locator("[data-form-field]").first().dblclick();
    const fieldDialog = page.getByRole("dialog", {
      name: "Form field properties",
      exact: true,
    });
    await expect(fieldDialog).toBeVisible();
    const value = fieldDialog.getByLabel("Field text", { exact: true });
    await value.fill(`${markers[0]}\nEDITED_ADDRESS\nSydney NSW 2000`);
    await fieldDialog
      .getByRole("button", { name: "Apply", exact: true })
      .click();
    await expect(editor).toContainText("EDITED_ADDRESS");
    await editor.press("Control+z");
    await expect(editor).not.toContainText("EDITED_ADDRESS");
    await editor.press("Control+y");
    await expect(editor).toContainText("EDITED_ADDRESS");
    if (stock.id === "labels-a4-21") {
      const html = await editor
        .locator("table")
        .evaluate((table) => table.outerHTML);
      await editor.press("Control+Home");
      await editor.press("Control+a");
      await editor.evaluate((el, html) => {
        const data = new DataTransfer();
        data.setData("text/html", html);
        el.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, html);
      await expect(editor.locator("[data-form-field]")).toHaveCount(
        markers.length,
      );
      await expect(editor).toContainText("EDITED_ADDRESS");
    }
    for (const scale of ["0.5", "1.5", "1"]) {
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
        .selectOption(scale);
      await settings
        .getByRole("button", { name: "Close settings", exact: true })
        .click();
      const geometry = await editor.evaluate((dom, stock) => {
        const canvas = dom.closest(".flow-canvas").getBoundingClientRect(),
          table = dom.querySelector("table"),
          rect = table.getBoundingClientRect();
        const factor = canvas.width / ((stock.paper[0] * 96) / 25.4);
        return {
          left: (rect.left - canvas.left) / factor,
          top: (rect.top - canvas.top) / factor,
          widths: [...table.rows[0].cells].map(
            (c) => c.getBoundingClientRect().width / factor,
          ),
          heights: [...table.rows].map(
            (r) => r.getBoundingClientRect().height / factor,
          ),
        };
      }, stock);
      const near = (a, b) => {
        if (Math.abs(a - (b * 96) / 25.4) > 1.2)
          throw Error(
            `Stock geometry at UI scale ${scale}: ${a}, expected ${b}mm`,
          );
      };
      near(geometry.left, stock.margins[3]);
      near(geometry.top, stock.margins[0]);
      geometry.widths.forEach((w, i) => near(w, stock.columns[i]));
      geometry.heights.forEach((h, i) => near(h, stock.rows[i]));
    }
    await expect(page.locator(".save-status")).toHaveText("Saved");
    const saved = await page.evaluate(
      (id) => window.alder.request("GET", `/api/projects/${id}`),
      id,
    );
    const dir = path.join(directory, stock.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "fixture-project.json"),
      JSON.stringify(saved),
    );
    const outputs = {
      skipListNumbers: true,
      formControlsExpected: markers.length,
      expectedText: [...markers, "EDITED_ADDRESS"],
    };
    for (const format of ["pdf", "docx"]) {
      const output = await page.evaluate(
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
        { id, format },
      );
      const file = path.join(dir, `alder.${format}`);
      fs.writeFileSync(file, Buffer.from(output.bytes));
      outputs[format] = { ...output.result, path: file };
      if (format === "pdf") {
        const task = getDocument({
          data: new Uint8Array(output.bytes),
          useSystemFonts: true,
        });
        const pdf = await task.promise;
        if (pdf.numPages !== 1)
          throw Error(`Expected one sheet, got ${pdf.numPages}`);
        const sheet = await pdf.getPage(1),
          view = sheet.view;
        if (
          Math.abs(((view[2] - view[0]) * 25.4) / 72 - stock.paper[0]) > 0.3 ||
          Math.abs(((view[3] - view[1]) * 25.4) / 72 - stock.paper[1]) > 0.3
        )
          throw Error("Wrong PDF paper size");
        const text = (await sheet.getTextContent()).items
          .map((i) => i.str)
          .join(" ");
        for (const marker of markers)
          if (text.split(marker).length !== 2)
            throw Error(`Missing or repeated ${marker}`);
        await task.destroy();
      }
    }
    fs.writeFileSync(
      path.join(dir, "fixture-exports.json"),
      JSON.stringify(outputs),
    );
    await page.getByRole("tab", { name: "Pages", exact: true }).click();
    await expect(page.locator(".page-card")).toHaveCount(1);
    await page.screenshot({ path: path.join(dir, "arrangement.png") });
    await page.getByRole("tab", { name: "Write", exact: true }).click();
    // Excessive address wording remains saved, but cannot be printed on misaligned stock.
    const overflow = structuredClone(saved);
    const first =
      overflow.book.chapters[0].document.content[0].content[0].content[0]
        .content[0].content[0];
    first.content = Array.from({ length: 90 }, (_, i) => [
      { type: "text", text: `OVERFLOW_${i}` },
      { type: "hard_break" },
    ]).flat();
    const tooLarge = await page.evaluate(
      (p) =>
        window.alder.request("PUT", `/api/projects/${p.id}`, {
          project: p,
          expectedRevision: p.revision,
        }),
      overflow,
    );
    const error = await page.evaluate(async (id) => {
      try {
        await window.alder.request("POST", `/api/projects/${id}/export`, {
          format: "pdf",
        });
        return "";
      } catch (e) {
        return e.message;
      }
    }, id);
    if (!error.includes("no longer fits this stationery"))
      throw Error(`Expected overflow refusal: ${error}`);
    await page.evaluate(
      ({ p, revision }) =>
        window.alder.request("PUT", `/api/projects/${p.id}`, {
          project: p,
          expectedRevision: revision,
        }),
      { p: saved, revision: tooLarge.revision },
    );
    report.stocks.push({
      id: stock.id,
      fields: markers.length,
      pages: 1,
      overflow: error,
    });
  }
  if (report.errors.length) throw Error(report.errors.join("\n"));
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.error = e.stack || String(e);
  if (page)
    await page
      .screenshot({ path: path.join(directory, "failure.png") })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  if (app) await app.close().catch(() => {});
}
