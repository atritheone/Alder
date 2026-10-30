import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/outline-lists"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-outline-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", checks: [], errors: [] };
let app, page;
const stage = (value) => {
  report.stage = value;
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
};
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(7000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const id = await page.evaluate(async () => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Outline lists",
      template: "blank",
    });
    const template = Array.from({ length: 9 }, (_, i) => ({
      format: "decimal",
      pattern:
        Array.from({ length: i + 1 }, (_, n) => `%${n + 1}`).join(".") + ".",
      start: 1,
      restart: i,
      indent: 24 * (i + 1),
      hanging: 18,
    }));
    Object.assign(template[1], { format: "lower-alpha", pattern: "%1(%2)" });
    Object.assign(template[2], {
      format: "lower-roman",
      pattern: "%1.%2.%3",
      restart: 0,
    });
    const para = (text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      }),
      item = (text, child) => ({
        type: "list_item",
        content: [para(text), ...(child ? [child] : [])],
      }),
      list = (content, attrs = {}) => ({
        type: "ordered_list",
        attrs,
        content,
      });
    Object.assign(p.settings, {
      documentKind: "docx",
      includeTitle: false,
      includeToc: false,
      footer: false,
    });
    p.book = {
      version: 1,
      chapters: [
        {
          id: "c",
          title: "Document",
          include: true,
          document: {
            type: "doc",
            content: [
              list(
                [
                  item(
                    "OUTLINE_A",
                    list([
                      item(
                        "OUTLINE_a",
                        list([item("OUTLINE_i"), item("OUTLINE_ii")]),
                      ),
                      item("OUTLINE_b", list([item("OUTLINE_iii")])),
                    ]),
                  ),
                ],
                { listTemplate: template, order: 3 },
              ),
              para("Between lists"),
              list(
                [
                  item(
                    "OUTLINE_B",
                    list([item("OUTLINE_c", list([item("OUTLINE_iv")]))]),
                  ),
                ],
                { listTemplate: template, continuePrevious: true },
              ),
            ],
          },
        },
      ],
    };
    await window.alder.request("PUT", `/api/projects/${p.id}`, {
      project: p,
      expectedRevision: p.revision,
    });
    return p.id;
  });
  const reopen = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: "Outline lists" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    markers = editor.locator(".outline-list-number");
  const expected = [
    "3.",
    "3(a)",
    "3.a.i",
    "3.a.ii",
    "3(b)",
    "3.b.iii",
    "4.",
    "4(a)",
    "4.a.iv",
  ];
  stage("derived labels");
  await expect(markers).toHaveText(expected);
  const menu = async () => {
    await expect(async () => {
      await editor
        .locator("p")
        .filter({ hasText: /OUTLINE_A$/ })
        .click({ button: "right" });
      await expect(
        page.getByRole("menuitem", { name: "List…", exact: true }),
      ).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 7000 });
    await page.getByRole("menuitem", { name: "List…", exact: true }).click();
  };
  const dialog = page.getByRole("dialog", { name: "List", exact: true });
  stage("edit outline and continuation");
  await menu();
  await expect(dialog.getByLabel("List structure")).toHaveValue("outline");
  await expect(dialog.getByLabel("Outline level start")).toHaveValue("3");
  await dialog
    .getByLabel("Outline level", { exact: true })
    .selectOption({ value: "1" });
  await dialog.getByLabel("Outline number pattern").fill("%1-%2");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(markers).toHaveText([
    "3.",
    "3-a",
    "3.a.i",
    "3.a.ii",
    "3-b",
    "3.b.iii",
    "4.",
    "4-a",
    "4.a.iv",
  ]);
  await editor.press("Control+z");
  await expect(markers).toHaveText(expected);
  stage("remove outline undo");
  await menu();
  await dialog.getByLabel("List structure").selectOption("ordinary");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(markers).toHaveCount(0);
  await editor.press("Control+z");
  await expect(markers).toHaveText(expected);
  report.checks.push(
    "Derived compound labels, linked pattern editing, ordinary/outline conversion and atomic undo.",
  );
  stage("caret and persistence");
  await editor.locator("p").filter({ hasText: "OUTLINE_iv" }).click();
  await editor.press("End");
  await page.keyboard.insertText(" edited");
  await expect(editor).toContainText("OUTLINE_iv edited");
  await expect(markers).toHaveText(expected);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(markers).toHaveText(expected);
  const saved = await page.evaluate(
    async (id) => await window.alder.request("GET", `/api/projects/${id}`),
    id,
  );
  expect(saved.book.chapters[0].text).not.toContain("3.a.");
  stage("shared PDF and Arrangement");
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
  fs.writeFileSync(path.join(directory, "outline.pdf"), Buffer.from(pdf.bytes));
  expect(pdf.result.validation.status).toBe("passed");
  expect(pdf.result.validation.pages).toBe(1);
  await page.screenshot({ path: path.join(directory, "write.png") });
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card .outline-list-number")).toHaveText(
    expected,
  );
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  for (const scale of ["0.5", "1.5", "1"]) {
    await page.evaluate(
      (scale) => localStorage.setItem("alder.uiScale", scale),
      scale,
    );
    await reopen();
    await expect(markers).toHaveText(expected);
    await menu();
    const fits = await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.left >= 0 &&
        r.top >= 0 &&
        r.right <= innerWidth + 1 &&
        r.bottom <= innerHeight + 1
      );
    });
    expect(fits).toBe(true);
    await dialog.press("Escape");
  }
  report.checks.push(
    "Caret editing, saved prose without generated labels, shared PDF, Arrangement and 50/100/150% UI scale.",
  );
  stage("numbered paragraph across pages");
  await page.evaluate(async (id)=>{
    const p=await window.alder.request("GET",`/api/projects/${id}`);
    const paragraph=p.book.chapters[0].document.content[0].content[0].content[0];
    paragraph.content=Array.from({length:100},(_,i)=>[...(i?[{type:"hard_break"}]:[]),{type:"text",text:`LONG_OUTLINE_${String(i).padStart(3,"0")} A line within one numbered item.`}]).flat();
    await window.alder.request("PUT",`/api/projects/${id}`,{project:p,expectedRevision:p.revision});
  },id);
  await reopen();
  await expect(editor).toContainText("LONG_OUTLINE_099");
  await expect(markers).toHaveText(expected);
  const longPdf=await page.evaluate(async(id)=>{
    const result=await window.alder.request("POST",`/api/projects/${id}/export`,{format:"pdf"});
    const bytes=[...new Uint8Array(await (await fetch(window.alder.mediaBase+result.downloadUrl)).arrayBuffer())];
    return {result,bytes};
  },id);
  fs.writeFileSync(path.join(directory,"long-outline.pdf"),Buffer.from(longPdf.bytes));
  expect(longPdf.result.validation.status).toBe("passed");
  expect(longPdf.result.validation.pages).toBeGreaterThan(2);
  report.checks.push("A single numbered paragraph flows across pages without changing its authored numbering.");
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
