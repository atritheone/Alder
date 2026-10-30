import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const expect = baseExpect.configure({ timeout: 45000 }),
  directory = path.resolve("work/note-images-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-note-images-"));
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
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const fixture = JSON.parse(
    fs.readFileSync("work/note-images-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Note images",
      template: "blank",
    });
    const bytes = Uint8Array.from(atob(fixture.assets[0].data), (c) =>
      c.charCodeAt(0),
    );
    const asset = await window.alder.upload(
      `/api/projects/${p.id}/assets?register=false`,
      "sample.png",
      [...bytes],
      {},
    );
    p.assets = [asset];
    const remap = (node) => {
      if (["image", "inline_image"].includes(node.type)) {
        node.attrs.assetId = asset.id;
        node.attrs.src = `/api/projects/${p.id}/assets/${asset.id}`;
      }
      if (node.type === "document_note") remap(node.attrs.body);
      node.content?.forEach(remap);
    };
    fixture.book.chapters.forEach((chapter) => remap(chapter.document));
    p.book = fixture.book;
    p.settings = fixture.settings;
    await window.alder.request("PUT", `/api/projects/${p.id}`, {
      project: p,
      expectedRevision: p.revision,
    });
    return p.id;
  }, fixture);
  const reopen = async (name = "Note images") => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.locator(".project-list-item").filter({ hasText: name }).click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    refs = editor.locator("[data-note-id]"),
    sheets = page.locator(".page-sheets > .page-sheet");
  const labels = () =>
    refs.evaluateAll((nodes) => nodes.map((node) => node.dataset.noteNumber));
  const menu = async (name) => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  const noteImages = page.locator(".page-sheets [data-note-fragment] img");
  await expect(noteImages).toHaveCount(4);
  await expect
    .poll(() =>
      noteImages.evaluateAll((images) =>
        images.every(
          (image) =>
            image.complete &&
            image.naturalWidth > 0 &&
            image.getBoundingClientRect().height > 5,
        ),
      ),
    )
    .toBe(true);
  report.initialPages = await sheets.count();
  await refs.first().dblclick();
  const dialog = page.getByRole("dialog", { name: "Notes", exact: true }),
    body = dialog.getByRole("textbox", { name: "Note text", exact: true });
  await expect(body.locator("img:not(.ProseMirror-separator)")).toHaveCount(2);
  await body.locator("img:not(.ProseMirror-separator)").first().click();
  await dialog
    .getByLabel("Note image", { exact: true })
    .selectOption("properties");
  let properties = page.getByRole("dialog", {
    name: "Image properties",
    exact: true,
  });
  await properties.getByLabel("Image width (mm)", { exact: true }).fill("30");
  await properties
    .getByLabel("Image alternative text", { exact: true })
    .fill("Updated note image");
  await properties.locator("summary").filter({ hasText: /^Crop/ }).click();
  await properties.getByLabel("Crop left (%)", { exact: true }).fill("20");
  await properties.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(body.locator("img:not(.ProseMirror-separator)").first()).toHaveAttribute(
    "alt",
    "Updated note image",
  );
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(noteImages.first()).toHaveAttribute("alt", "Updated note image");
  await editor.press("Control+z");
  await expect(noteImages.first()).toHaveAttribute("alt", "Inline note sample");
  await editor.press("Control+y");
  await expect(noteImages.first()).toHaveAttribute("alt", "Updated note image");
  await refs.first().dblclick();
  await body.press("Control+End");
  await dialog
    .getByLabel("Add note image", { exact: true })
    .setInputFiles("work/note-images-word/sample.png");
  await expect(body.locator("img:not(.ProseMirror-separator)")).toHaveCount(3);
  await expect(body.locator('p').last().locator('img:not(.ProseMirror-separator)')).toHaveCount(1);
  await body.press("Control+z");
  await expect(body.locator("img:not(.ProseMirror-separator)")).toHaveCount(2);
  await body.press("Control+y");
  await expect(body.locator("img:not(.ProseMirror-separator)")).toHaveCount(3);
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(noteImages).toHaveCount(5);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(noteImages).toHaveCount(5);
  const offsets=await page.evaluate(async id=>{
    const p=await window.alder.request('GET',`/api/projects/${id}`),notes=new Map();
    const text=node=>node.type==='text'?node.text||'':node.type==='hard_break'?'\n':(node.content||[]).map(text).join(node.type==='doc'?'\n':'');
    const visit=node=>{if(node.type==='document_note')notes.set(node.attrs.blockId,text(node.attrs.body));node.content?.forEach(visit);};
    visit(p.book.chapters[0].document);
    return [...document.querySelectorAll('.page-sheets [data-note-from]')].map(span=>{
      const id=span.closest('[data-note-fragment]').dataset.noteFragment;
      return {actual:span.textContent,expected:notes.get(id).slice(Number(span.dataset.noteFrom),Number(span.dataset.noteTo))};
    });
  },id);
  expect(offsets.length).toBeGreaterThan(70);expect(offsets.every(value=>value.actual===value.expected)).toBe(true);
  for (const scale of [0.5, 1, 1.5]) {
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
    await expect(noteImages).toHaveCount(5);
    const geometry = await noteImages.evaluateAll((images) =>
      images.map((image) => {
        const box = image.getBoundingClientRect(),
          page = image.closest(".page-sheet").getBoundingClientRect();
        return {
          inside:
            box.left >= page.left - 1 &&
            box.right <= page.right + 1 &&
            box.top >= page.top - 1 &&
            box.bottom <= page.bottom + 1,
          height: box.height,
        };
      }),
    );
    expect(geometry.every((g) => g.inside && g.height > 5)).toBe(true);
  }
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card [data-note-fragment] img")).toHaveCount(
    5,
  );
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
  await page.screenshot({ path: path.join(directory, "note-images.png") });
  report.checks.push(
    "Inline/block images in notes, image properties/crop/alt, local and project undo/redo, upload, save/reopen, scale geometry, Arrangement and PDF",
  );
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
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
