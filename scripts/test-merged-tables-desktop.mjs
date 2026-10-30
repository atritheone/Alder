import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const expect = baseExpect.configure({ timeout: 20000 }),
  directory = path.resolve("work/merged-tables-ui");
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(
  path.join(os.tmpdir(), "alder-merged-qualified-"),
);
const report = { status: "running", cases: [], errors: [] };
const fixture = JSON.parse(
  fs.readFileSync("work/merged-table-exact-word/fixture-project.json", "utf8"),
);
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    sheets = page.locator(".page-sheets > .page-sheet");
  const reopen = async (name) => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.locator(".project-list-item").filter({ hasText: name }).click();
    await expect(editor.locator("table")).toHaveCount(1);
    await expect(page.locator(".save-status")).toHaveText("Saved");
  };
  const geometry = () =>
    editor.evaluate((root) => {
      const sheets = [
        ...document.querySelectorAll(".page-sheets > .page-sheet"),
      ].map((p) => p.getBoundingClientRect());
      return [...root.querySelectorAll("table p")].map((p) => {
        const r = p.getBoundingClientRect(),
          page = sheets.findIndex(
            (s) => r.top >= s.top && r.bottom <= s.bottom,
          );
        return {
          text: p.textContent,
          page,
          top: page < 0 ? -1 : (r.top - sheets[page].top) / sheets[page].height,
          bottom:
            page < 0 ? -1 : (r.bottom - sheets[page].top) / sheets[page].height,
        };
      });
    });
  const valid = async () => {
    const g = await geometry();
    expect(
      g.filter(
        (p) =>
          p.page < 0 ||
          p.top < 20 / 210 - 0.002 ||
          p.bottom > 190 / 210 + 0.002,
      ),
    ).toEqual([]);
    return g;
  };
  for (const mode of ["top", "middle", "bottom", "combined", "minimum"]) {
    const p = structuredClone(fixture),
      table = p.book.chapters[0].document.content[1],
      merged = table.content[1].content[0];
    if (mode === "middle" || mode === "bottom") {
      merged.attrs.verticalAlign = mode;
      merged.content = merged.content.slice(0, 4);
    }
    if (mode === "combined") {
      const cells = table.content[2].content;
      cells[0].attrs.colspan = 2;
      cells[0].attrs.colwidth = [136, 136];
      cells[0].content.push(...cells[1].content);
      cells.pop();
    }
    if (mode === "minimum") {
      table.content.forEach((row) =>
        row.content.forEach(
          (cell) => (cell.content = cell.content.slice(0, 1)),
        ),
      );
      table.content.slice(1, 3).forEach((row) => (row.attrs.minHeight = 72));
      merged.attrs.verticalAlign = "middle";
    }
    const name = `Merged ${mode}`;
    const id = await page.evaluate(
      async ({ p, name }) => {
        const value = await window.alder.request("POST", "/api/projects", {
          name,
          template: "blank",
        });
        value.book = p.book;
        value.settings = p.settings;
        await window.alder.request("PUT", `/api/projects/${value.id}`, {
          project: value,
          expectedRevision: value.revision,
        });
        return value.id;
      },
      { p, name },
    );
    await reopen(name);
    let g = await valid();
    const count = await sheets.count();
    expect(count).toBe(mode === "minimum" ? 1 : 3);
    if (mode === "middle" || mode === "bottom") {
      const a = g.find((p) => p.text === "MERGED_000"),
        b = g.find((p) => p.text === "UPPER_B_000");
      expect(((a.top - b.top) * 210 * 72) / 25.4).toBeCloseTo(
        mode === "middle" ? 198 : 396,
        0,
      );
    }
    if (mode === "minimum") {
      const a = g.find((p) => p.text === "MERGED_000"),
        b = g.find((p) => p.text === "UPPER_B_000");
      expect(((a.top - b.top) * 210 * 72) / 25.4).toBeCloseTo(63.625, 0);
    }
    if (mode === "top") {
      await editor.getByText("LOWER_C_035", { exact: true }).click();
      await page.keyboard.press("Home");
      await page.keyboard.type("EDITED ");
      await expect(editor).toContainText("EDITED LOWER_C_035");
      await page.keyboard.press("Control+z");
      await expect(editor).not.toContainText("EDITED");
      await expect(page.locator(".save-status")).toHaveText("Saved");
      await reopen(name);
      const restored = await geometry();
      expect(restored.map((p) => [p.text, p.page])).toEqual(
        g.map((p) => [p.text, p.page]),
      );
      restored.forEach((p, i) => expect(p.top).toBeCloseTo(g[i].top, 4));
      for (const [scale, zoom] of [
        [0.5, 0.5],
        [1, 1],
        [1.5, 3],
      ]) {
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
        await settings
          .getByRole("button", { name: "Done", exact: true })
          .click();
        await page
          .getByLabel("Page zoom", { exact: true })
          .selectOption(String(zoom));
        await expect(sheets).toHaveCount(count);
        await valid();
      }
      await page.getByLabel("Page zoom", { exact: true }).selectOption("1");
    }
    await page.getByRole("tab", { name: "Pages", exact: true }).click();
    await expect(page.locator(".page-card")).toHaveCount(count);
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
    expect(pdf.result.validation.pages).toBe(count);
    fs.writeFileSync(
      path.join(directory, `${mode}.pdf`),
      Buffer.from(pdf.bytes),
    );
    const task = getDocument({ data: new Uint8Array(pdf.bytes) }),
      document = await task.promise;
    const texts = [];
    for (let i = 1; i <= document.numPages; i++)
      texts.push(
        (await (await document.getPage(i)).getTextContent()).items
          .map((item) => item.str || "")
          .join(" "),
      );
    await task.destroy();
    const all = texts.join(" ");
    g = await valid();
    for (const paragraph of g.filter((p) => !p.text.startsWith("HEADER_")))
      expect(
        all.split(paragraph.text).length - 1,
        `${mode}: ${paragraph.text}`,
      ).toBe(1);
    for (const text of texts)
      for (const label of ["HEADER_A_000", "HEADER_B_000", "HEADER_C_000"])
        expect(text.split(label).length - 1).toBe(1);
    await page.screenshot({ path: path.join(directory, `${mode}.png`) });
    report.cases.push({
      mode,
      pages: count,
      paragraphs: g.length,
      geometry: g,
    });
  }
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
