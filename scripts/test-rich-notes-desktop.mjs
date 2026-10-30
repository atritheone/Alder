import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const expect = baseExpect.configure({ timeout: 30000 }),
  directory = path.resolve("work/rich-notes-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-rich-notes-"));
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
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "beforeunload") await dialog.accept().catch(() => {});
    else {
      report.errors.push(dialog.message());
      await dialog.dismiss().catch(() => {});
    }
  });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const fixture = JSON.parse(
    fs.readFileSync("work/rich-notes-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (f) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Rich note stories",
      template: "blank",
    });
    p.book = f.book;
    p.settings = f.settings;
    p.styles = f.styles;
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
      .filter({ hasText: "Rich note stories" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    refs = editor.locator("[data-note-id]"),
    sheets = page.locator(".page-sheets > .page-sheet");
  await expect(page.locator(".page-sheets")).toContainText("LONG44");
  const initial = await sheets.count();
  expect(initial).toBeGreaterThan(2);
  report.pages = initial;
  const verify = async () => {
    const result = await page.evaluate(async (id) => {
      const p = await window.alder.request("GET", `/api/projects/${id}`);
      const project = p.project || p,
        bodies = new Map();
      const text = (n) =>
        n.type === "text"
          ? n.text || ""
          : n.type === "hard_break"
            ? "\n"
            : ["image", "inline_image"].includes(n.type)
              ? ""
              : (n.content || [])
                  .map(text)
                  .join(
                    n.type === "table_row"
                      ? "\t"
                      : [
                            "doc",
                            "ordered_list",
                            "bullet_list",
                            "list_item",
                            "table",
                            "table_cell",
                            "table_header",
                          ].includes(n.type)
                        ? "\n"
                        : "",
                  );
      const visit = (n) => {
        if (n.type === "document_note")
          bodies.set(n.attrs.blockId, text(n.attrs.body));
        n.content?.forEach(visit);
      };
      project.book.chapters.forEach((c) => visit(c.document));
      const failures = [];
      let count = 0;
      for (const node of document.querySelectorAll(
        ".page-sheets [data-note-from]",
      )) {
        const note = node.closest("[data-note-fragment]"),
          source = bodies.get(note?.dataset.noteFragment),
          from = +node.dataset.noteFrom,
          to = +node.dataset.noteTo;
        if (source?.slice(from, to) !== node.textContent)
          failures.push({
            from,
            to,
            text: node.textContent,
            source: source?.slice(from, to),
          });
        count++;
        const box = node.getBoundingClientRect(),
          sheet = node.closest(".page-sheet").getBoundingClientRect();
        if (box.top < sheet.top - 1 || box.bottom > sheet.bottom + 1)
          failures.push({ outside: node.textContent });
      }
      return { failures, count };
    }, id);
    expect(result.failures).toEqual([]);
    expect(result.count).toBeGreaterThan(200);
    return result.count;
  };
  report.words = await verify();
  await refs.first().dblclick();
  const dialog = page.getByRole("dialog", { name: "Notes", exact: true }),
    body = dialog.getByRole("textbox", { name: "Note text", exact: true });
  await expect(body.locator("ol")).toHaveCount(1);
  await expect(body.locator("table")).toHaveCount(1);
  await body.locator("td").filter({ hasText: "RIGHT01" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" EDITED");
  await body.press("Control+z");
  await expect(body).not.toContainText("EDITED");
  await body.press("Control+y");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-sheets")).toContainText("EDITED");
  await editor.press("Control+z");
  await expect(page.locator(".page-sheets")).not.toContainText("EDITED");
  await editor.press("Control+y");
  await expect(page.locator(".page-sheets")).toContainText("EDITED");
  await expect
    .poll(async () =>
      page.evaluate(
        async (id) =>
          JSON.stringify(
            await window.alder.request("GET", `/api/projects/${id}`),
          ),
        id,
      ),
    )
    .toContain("EDITED");
  await reopen();
  await expect(page.locator(".page-sheets")).toContainText("EDITED");
  await refs.last().dblclick();
  await body.press("Control+End");
  await body.press("Enter");
  await page.keyboard.type("NEW LIST ITEM");
  await expect(body.locator("ol > li")).toHaveCount(3);
  await body.press("Tab");
  await body.press("Shift+Tab");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-sheets")).toContainText("NEW LIST ITEM");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const editedPages = await sheets.count();
  report.editedPages = editedPages;
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
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await expect(sheets).toHaveCount(editedPages);
    await verify();
  }
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(editedPages);
  await page.getByRole("tab", { name: "Write", exact: true }).click();
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
  fs.writeFileSync(path.join(directory, "notes.pdf"), Buffer.from(pdf.bytes));
  report.pdf = pdf.result.validation;
  await editor.press("Control+Home");
  await page.screenshot({ path: path.join(directory, "rich-notes.png") });
  report.checks.push(
    "Lists/nested lists, parallel and merged table cells, multi-page long row, exact narration offsets, local/document undo, save/reopen, UI scale, Arrangement and PDF",
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
