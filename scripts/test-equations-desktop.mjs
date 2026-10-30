import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const expect = baseExpect.configure({ timeout: 30000 }),
  directory = path.resolve("work/equations-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-equations-"));
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
  await newDialog.locator("input[name=name]").fill("Equation qualification");
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
  const samples = [
    String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`,
    String.raw`\int_0^1 x^2 dx`,
    String.raw`\vec{v}+\overline{AB}+\mathbb{R}+\mathcal{L}`,
    String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
    String.raw`\sum_{i=1}^{n}\sqrt[3]{x}`,
  ];
  for (const [i, source] of samples.entries()) {
    report.stage = `insert ${i}`;
    await editor.press("Control+End");
    if (i) await editor.press("Enter");
    await editor.pressSequentially(`FORMULA_${i} `);
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Insert equation…", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Equation properties" });
    await expect(dialog.locator("math-field")).toBeVisible();
    await dialog.locator("math-field").evaluate((el, value) => {
      el.value = value;
      el.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText" }),
      );
    }, source);
    await expect(dialog.locator(".equation-preview math")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Apply", exact: true }),
    ).toBeEnabled();
    await dialog
      .getByLabel("Equation reading description")
      .fill(`Formula ${i}: accessible reading.`);
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(editor.locator("[data-equation]")).toHaveCount(i + 1);
    await editor.press("Control+z");
    await expect(editor.locator("[data-equation]")).toHaveCount(i);
    await editor.press("Control+y");
    await expect(editor.locator("[data-equation]")).toHaveCount(i + 1);
    await editor.press("ArrowRight");
    await editor.pressSequentially(" after.");
  }
  report.stage = "edit and clipboard";
  const first = editor.locator("[data-equation]").first();
  const original = await first.getAttribute("data-equation");
  await first.dblclick();
  const properties = page.getByRole("dialog", { name: "Equation properties" });
  await expect(properties.locator("math-field")).toBeVisible();
  await properties.getByRole("button", { name: "Apply", exact: true }).click();
  if (
    JSON.parse(await first.getAttribute("data-equation")).mathML !==
    JSON.parse(original).mathML
  )
    throw Error("Opening properties changed formula");
  const html = await first.evaluate((el) => el.outerHTML);
  await editor.press("Control+End");
  await editor.press("Enter");
  await editor.evaluate((el, html) => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", html);
    transfer.setData("text/plain", "Formula 0: accessible reading.");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, html);
  await expect(editor.locator("[data-equation]")).toHaveCount(6);
  await editor.press("Control+End");
  await editor.pressSequentially(" AFTER_COPY");
  await expect(editor).toContainText("AFTER_COPY");
  const caret = await editor.evaluate((el) => {
    const last = el.querySelector("[data-equation]:last-of-type");
    const selection = document.getSelection(),
      range = selection.getRangeAt(0).cloneRange();
    const ink = el.parentElement
        .querySelector(".write-caret")
        .getBoundingClientRect(),
      rect = range.getBoundingClientRect();
    return {
      left: ink.left,
      nativeLeft: rect.left,
      top: ink.top,
      nativeTop: rect.top,
    };
  });
  if (caret.nativeLeft && Math.abs(caret.left - caret.nativeLeft) > 3)
    throw Error("Caret shifted after equation");
  report.caret = caret;
  await editor.press("Control+z");
  await expect(editor).not.toContainText("AFTER_COPY");
  await first.dblclick();
  await expect(properties.locator("math-field")).toBeVisible();
  await properties.locator("math-field").click();
  await properties.locator("math-field").evaluate((el) => {
    window.__equationKeys = [];
    for (const kind of ["keydown", "keyup", "beforeinput", "input"])
      window.addEventListener(
        kind,
        (e) =>
          window.__equationKeys.push({
            kind,
            target: e.target?.tagName,
            key: e.key,
            code: e.code,
            data: e.data,
            type: e.inputType,
            prevented: e.defaultPrevented,
            focus: document.hasFocus(),
          }),
        true,
      );
  });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.focus();
    w.webContents.focus();
  });
  await properties.locator("math-field").focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("y+1");
  await expect(properties.locator(".equation-preview")).toContainText("y");
  await properties.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(first.locator("math")).toContainText("y");
  await editor.press("Control+z");
  await expect(first.locator("math")).toContainText("x");
  for (const scale of ["0.5", "1.5", "1"]) {
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
    await expect(properties.locator("math-field")).toBeVisible();
    const fits = await properties.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.left >= 0 &&
        r.top >= 0 &&
        r.right <= innerWidth + 1 &&
        r.bottom <= innerHeight + 1
      );
    });
    if (!fits) throw Error("Equation dialog overflow at UI scale " + scale);
    await properties
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
  }
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await editor.locator('[data-equation]').last().dblclick();
  await properties.getByLabel('Equation placement').selectOption('display');
  await expect(properties.getByRole('button',{name:'Apply',exact:true})).toBeEnabled();
  await properties.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(editor.locator('[data-equation]').last()).toHaveAttribute('data-equation',/display/);
  await expect(page.locator('.save-status')).toHaveText('Saved');
  let project = await page.evaluate(async () => {
    const p = (
      await window.alder.request("GET", "/api/projects")
    ).projects.find((p) => p.name === "Equation qualification");
    return window.alder.request("GET", `/api/projects/${p.id}`);
  });
  fs.writeFileSync(
    path.join(directory, "fixture-project.json"),
    JSON.stringify(project, null, 2),
  );
  fs.writeFileSync(
    path.join(directory, "fixture-expected.json"),
    JSON.stringify({
      expectedText: samples.map((_, i) => `FORMULA_${i}`),
      skipListNumbers: true,
    }),
  );
  report.stage = "reopen";
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Equation qualification" })
    .click();
  await expect(editor.locator("[data-equation]")).toHaveCount(6);
  const geometry = await editor
    .locator("[data-equation]")
    .evaluateAll((elements) =>
      elements.map((el) => {
        const r = el.getBoundingClientRect();
        const math = el.querySelector("math").getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          mathWidth: math.width,
          mathHeight: math.height,
        };
      }),
    );
  if (
    geometry.some(
      (g) =>
        g.width < 10 || g.height < 10 || Math.abs(g.width - g.mathWidth) > 2,
    )
  )
    throw Error("Invalid math geometry");
  report.geometry = geometry;
  await page.screenshot({ path: path.join(directory, "write.png") });
  const outputs = {};
  await app.evaluate(({ app }) =>
    app.on("web-contents-created", (_event, wc) => {
      const print = wc.printToPDF.bind(wc);
      wc.printToPDF = async (...args) => {
        global.__equationPublication = await wc.executeJavaScript(
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
        const r = await window.alder.request(
          "POST",
          `/api/projects/${id}/export`,
          { format },
        );
        const response = await fetch(window.alder.mediaBase + r.downloadUrl);
        return {
          result: r,
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
    expectedText: samples.map((_, i) => `FORMULA_${i}`),
    skipListNumbers: true,
    equationsExpected: 6,
  });
  const printedHTML = await app.evaluate(() => global.__equationPublication);
  if (printedHTML)
    fs.writeFileSync(path.join(directory, "publication.html"), printedHTML);
  fs.writeFileSync(
    path.join(directory, "fixture-exports.json"),
    JSON.stringify(outputs, null, 2),
  );
  report.stage = "arrangement";
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(1);
  await expect(page.locator(".page-card math")).toHaveCount(6);
  await page.screenshot({ path: path.join(directory, "arrangement.png") });
  report.stage='overflow';
  const oversized=structuredClone(project);
  oversized.book.chapters[0].document.content[0].content.find(n=>n.type==='equation').attrs.mathML=`<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>${'W'.repeat(200)}</mi></math>`;
  const stored=await page.evaluate(p=>window.alder.request('PUT',`/api/projects/${p.id}`,{project:p,expectedRevision:p.revision}),oversized);
  for(const format of ['pdf','docx']){
    const error=await page.evaluate(async({id,format})=>{try{await window.alder.request('POST',`/api/projects/${id}/export`,{format});return '';}catch(e){return e.message;}},{id:project.id,format});
    if(!error.includes('equation is too large'))throw Error(`Expected ${format} overflow refusal: ${error}`);
  }
  await page.evaluate(({p,revision})=>window.alder.request('PUT',`/api/projects/${p.id}`,{project:p,expectedRevision:revision}),{p:project,revision:stored.revision});
  if (report.errors.length) throw Error(report.errors.join("\n"));
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.error = e.stack || String(e);
  if (page) {
    report.equationKeys = await page.evaluate(() => window.__equationKeys);
    report.equationState = await page
      .locator("math-field")
      .evaluateAll((fields) =>
        fields.map((el) => ({
          value: el.value,
          readonly: el.readOnly,
          editable: el.contentEditable,
          active: document.activeElement === el,
          innerActive: el.shadowRoot?.activeElement?.outerHTML,
          userSelect: getComputedStyle(el).userSelect,
        })),
      )
      .catch(() => []);
  }
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
