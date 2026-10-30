import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/notes-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-notes-ui-"));
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
  page.setDefaultTimeout(10000);
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
  const fixture = JSON.parse(
    fs.readFileSync("work/notes-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Notes desktop",
      template: "blank",
    });
    p.settings = fixture.settings;
    p.styles = fixture.styles;
    p.book = fixture.book;
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
      .filter({ hasText: "Notes desktop" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    refs = editor.locator("[data-note-id]");
  await expect(refs).toHaveCount(3);
  await expect(page.locator(".page-sheets > .page-sheet")).toHaveCount(1);
  await expect(page.locator(".page-sheets")).toContainText("FOOTNOTE ONE");
  await expect(page.locator(".page-sheets")).toContainText("ENDNOTE ONE");
  const menu = async (name) => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  await editor.press("Control+Home");
  await editor.press("Control+Shift+ArrowRight");
  await menu("Notes…");
  const dialog = page.getByRole("dialog", { name: "Notes", exact: true }),
    body = dialog.getByRole("textbox", { name: "Note text", exact: true });
  await body.fill("NEW NOTE");
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(refs).toHaveCount(4);
  await expect(editor).toContainText("BODY FIRST");
  await expect(editor).not.toContainText("NEW NOTE");
  await expect(page.locator(".page-sheets")).toContainText("NEW NOTE");
  await editor.press("Control+z");
  await expect(refs).toHaveCount(3);
  await editor.press("Control+y");
  await expect(refs).toHaveCount(4);
  await refs.first().dblclick();
  await body.fill("CANCELLED NOTE");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".page-sheets")).not.toContainText(
    "CANCELLED NOTE",
  );
  await refs.first().dblclick();
  await body.fill("UPDATED NOTE");
  await body.press("Tab");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-sheets")).toContainText("UPDATED NOTE");
  await editor.press("Control+z");
  await expect(page.locator(".page-sheets")).toContainText("NEW NOTE");
  report.checks.push(
    "Insert/edit/cancel, separate undo/redo and body/note text isolation",
  );
  await editor.press("Control+a");
  // The isolated Windows desktop has no system clipboard. Exercise the real
  // editor copy/paste handlers with a local DataTransfer instead.
  const copied = await editor.evaluate((element) => {
    const data = new DataTransfer();
    element.dispatchEvent(
      new ClipboardEvent("copy", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    return {
      text: data.getData("text/plain"),
      html: data.getData("text/html"),
    };
  });
  expect(copied.html).toContain("data-document-note");
  await editor.press("Control+End");
  await editor.press("Enter");
  await editor.evaluate((element, copied) => {
    const data = new DataTransfer();
    data.setData("text/plain", copied.text);
    data.setData("text/html", copied.html);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, copied);
  await expect(refs).toHaveCount(8);
  const ids = await refs.evaluateAll((nodes) =>
    nodes.map((node) => node.dataset.noteId),
  );
  expect(new Set(ids).size).toBe(8);
  await editor.press("Control+z");
  await expect(refs).toHaveCount(4);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(refs).toHaveCount(4);
  await expect(page.locator(".page-sheets")).toContainText("NEW NOTE");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const openSettings=async()=>app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()
        .items.flatMap((m) => m.submenu?.items || [])
        .find((i) => i.label === "Settings…");
      Reflect.apply(item.click, item, [
        { triggeredByAccelerator: false },
        BrowserWindow.getAllWindows()[0],
        {},
      ]);
    });
  await editor.press('Control+End');await editor.press('Enter');await editor.pressSequentially('See note ');
  await menu('Insert cross-reference…');
  const reference=page.getByRole('dialog',{name:'Insert cross-reference',exact:true});
  const target=await reference.locator('option').filter({hasText:'FOOTNOTE ONE'}).getAttribute('value');
  await reference.getByLabel('Reference target',{exact:true}).selectOption(target);
  await expect(reference.getByLabel('Reference display',{exact:true})).toHaveValue('number');
  await reference.getByRole('button',{name:'Insert',exact:true}).click();
  await expect(editor.locator('[data-cross-reference]')).toHaveText('2');
  await openSettings();await settings.getByRole('tab',{name:'Page Layout',exact:true}).click();
  await settings.locator('summary').filter({hasText:/^Footnotes$/}).click();
  await settings.getByLabel('Footnotes number format',{exact:true}).selectOption('upperRoman');
  await settings.getByLabel('Footnotes start at',{exact:true}).fill('3');
  await settings.getByLabel('Footnotes placement',{exact:true}).selectOption('beneathText');
  await settings.locator('summary').filter({hasText:/^Endnotes$/}).click();
  await settings.getByLabel('Endnotes number format',{exact:true}).selectOption('decimal');
  await settings.getByLabel('Endnotes start at',{exact:true}).fill('5');
  await settings.getByRole('button',{name:'Done',exact:true}).click();
  await expect(refs.first()).toHaveAttribute('data-note-number','III');
  await expect.poll(()=>page.locator('[data-footnotes]').first().evaluate(node=>node.style.top)).not.toBe('');
  await menu('Update fields');await expect(editor.locator('[data-cross-reference]')).toHaveText('IV');
  await editor.locator('[data-cross-reference]').click({modifiers:['Control']});await expect(editor).toBeFocused();
  await expect(page.locator('.save-status')).toHaveText('Saved');await reopen();
  await expect(refs.first()).toHaveAttribute('data-note-number','III');
  await expect(editor.locator('[data-cross-reference]')).toHaveText('IV');
  report.checks.push('Note numbering and placement settings persist; note references update and navigate');
  for (const scale of ["0.5", "1", "1.5"]) {
    await openSettings();
    await settings
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await settings.getByLabel("UI Scale", { exact: true }).selectOption(scale);
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.locator(".page-sheets > .page-sheet")).toHaveCount(1);
  }
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(1);
  await expect(page.locator(".page-card").first()).toContainText(
    "FOOTNOTE ONE",
  );
  await expect(page.locator(".page-card").last()).toContainText("ENDNOTE ONE");
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
  expect(pdf.result.validation.pages).toBe(1);
  fs.writeFileSync(path.join(directory, "notes.pdf"), Buffer.from(pdf.bytes));
  report.checks.push(
    "Independent copied notes, save/reopen, UI scales, Arrangement and desktop PDF",
  );
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.notes = await page
    ?.locator(".page-flow [data-note-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.documentNote))
    .catch(() => []);
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
