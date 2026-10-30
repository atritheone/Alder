import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const expect = baseExpect.configure({ timeout: 20000 }),
  directory = path.resolve("work/nested-tables-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-nested-qualified-"));
fs.mkdirSync(directory, { recursive: true });
const fixture = JSON.parse(
  fs.readFileSync("work/nested-table-word/fixture-project.json", "utf8"),
);
const report = { status: "running", cases: [], errors: [] };
const nodes = (node) => [node, ...(node.content || []).flatMap(nodes)];
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    sheets = page.locator(".page-sheets > .page-sheet");
  const reopen = async (name, count) => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.locator(".project-list-item").filter({ hasText: name }).click();
    await expect(editor.locator("table")).toHaveCount(count);
    await expect(page.locator(".save-status")).toHaveText("Saved");
  };
  const geometry = () =>
    editor.evaluate((root) => {
      const sheets = [
        ...document.querySelectorAll(".page-sheets > .page-sheet"),
      ].map((p) => p.getBoundingClientRect());
      return [...root.querySelectorAll("table p")].map((p) => {
        const rect = p.getBoundingClientRect(),
          page = sheets.findIndex(
            (s) => rect.top >= s.top && rect.bottom <= s.bottom,
          ),
          cell = p.closest("td,th").getBoundingClientRect();
        return {
          text: p.textContent,
          page,
          top:
            page < 0 ? -1 : (rect.top - sheets[page].top) / sheets[page].height,
          bottom:
            page < 0
              ? -1
              : (rect.bottom - sheets[page].top) / sheets[page].height,
          inside:
            rect.left >= cell.left - 0.5 && rect.right <= cell.right + 0.5,
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
          p.bottom > 190 / 210 + 0.002 ||
          !p.inside,
      ),
    ).toEqual([]);
    return g;
  };
  for (const mode of ["ordinary", "merged", "paired", "lists"]) {
    const p = structuredClone(fixture),
      table = p.book.chapters[0].document.content[1],
      outer = table.content[1],
      nested = outer.content[0].content[1];
    if (mode === "merged") {
      nested.content[1].content[0].attrs.rowspan = 2;
      nested.content[2].content.shift();
    }
    if (mode === "paired") {
      const other = JSON.parse(
        JSON.stringify(nested)
          .replaceAll("NEST_", "PAIR_")
          .replaceAll("INNER_", "PAIRED_"),
      );
      nodes(other)
        .filter((n) => n.type === "table_cell" || n.type === "table_header")
        .forEach((n) => (n.attrs.colwidth = [62]));
      outer.content[1].content = [
        outer.content[1].content[0],
        other,
        {
          type: "paragraph",
          content: [{ type: "text", text: "AFTER_PAIRED" }],
        },
      ];
    }
    if (mode === "lists") {
      const paragraphs = outer.content[1].content;
      outer.content[1].content = [
        {
          type: "ordered_list",
          attrs: { order: 3 },
          content: paragraphs.map((p) => ({ type: "list_item", content: [p] })),
        },
      ];
    }
    const name = `Nested ${mode}`,
      document = p.book.chapters[0].document,
      tableCount = nodes(document).filter((n) => n.type === "table").length;
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
    await reopen(name, tableCount);
    let g = await valid();
    const count = await sheets.count();
    expect(count).toBeGreaterThan(1);
    if (mode === "ordinary") {
      await editor.getByText("NEST_A_040", { exact: true }).click();
      await page.keyboard.press("Home");
      await page.keyboard.type("EDITED ");
      await expect(editor).toContainText("EDITED NEST_A_040");
      await page.keyboard.press("Control+z");
      await expect(editor).not.toContainText("EDITED");
      await expect(page.locator(".save-status")).toHaveText("Saved");
      await reopen(name, tableCount);
      expect((await geometry()).map((p) => [p.text, p.page])).toEqual(
        g.map((p) => [p.text, p.page]),
      );
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
      output = await task.promise,
      texts = [];
    for (let i = 1; i <= output.numPages; i++)
      texts.push(
        (await (await output.getPage(i)).getTextContent()).items
          .map((item) => item.str || "")
          .join("")
          .replaceAll(/\s/g, ""),
      );
    await task.destroy();
    const all = texts.join("");
    g = await valid();
    const headers = nodes(document)
      .filter((n) => n.type === "table_header")
      .flatMap((cell) =>
        nodes(cell)
          .filter((n) => n.type === "text")
          .map((n) => n.text),
      );
    for (const text of nodes(document)
      .filter((n) => n.type === "text")
      .map((n) => n.text)
      .filter((text) => !headers.includes(text)))
      expect(
        all.split(text.replaceAll(/\s/g, "")).length - 1,
        `${mode}: ${text}`,
      ).toBe(1);
    for (const text of texts)
      for (const header of headers)
        expect(
          text.split(header).length - 1,
          `${mode}: repeated ${header}`,
        ).toBeLessThanOrEqual(1);
    expect(texts[1]).toContain("INNER_HEAD_A_000");
    expect(texts[1]).toContain("OUTER_HEAD_A_000");
    await page.screenshot({ path: path.join(directory, `${mode}.png`) });
    report.cases.push({ mode, pages: count, tables: tableCount, geometry: g });
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
