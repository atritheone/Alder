import { _electron as electron, expect } from "@playwright/test";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { desktopExecutable } from "./desktop-paths.mjs";

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const directory = path.resolve("work/text-boxes-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-box-"));

fs.mkdirSync(directory, { recursive: true });

const report = { status: "running", cases: [], errors: [] };
let app, page;

const text = (text) => ({ type: "text", text });

const overlaps = (root) => {
  const boxes = [...root.querySelectorAll("[data-text-box]")],
    failures = [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode,
      parent = node.parentElement;

    if (
      !node.textContent.trim() ||
      parent.closest(
        '[aria-hidden="true"],.pagination-spacer,.structure-marker',
      ) ||
      getComputedStyle(parent).visibility === "hidden"
    )
      continue;

    const range = document.createRange();
    range.selectNodeContents(node);

    for (const rect of range.getClientRects())
      for (const box of boxes) {
        if (box.contains(node)) continue;

        const sheet = box.closest(".page-snapshot,.publication-sheet");
        if (sheet && !sheet.contains(node)) continue;

        const b = box.getBoundingClientRect();
        if (
          Math.min(rect.right, b.right) - Math.max(rect.left, b.left) > 1 &&
          Math.min(rect.bottom, b.bottom) - Math.max(rect.top, b.top) > 1
        )
          failures.push(node.textContent.slice(0, 25));
      }
  }

  return failures;
};

try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });

  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => report.errors.push(e.message));

  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();

  for (const name of ["inline", "wrapped", "edge", "table"]) {
    report.stage = name;

    const blocks = Array.from({ length: 30 }, (_, i) => ({
      type: "paragraph",
      attrs: {
        fontFamily: "Cambria",
        fontSize: 10,
        lineSpacingMode: "exact",
        lineSpacing: 14,
        spaceAfter: 4,
      },
      content: [
        text(
          `PASSAGE_${String(i).padStart(3, "0")} This paragraph keeps its original wording as text flows around the rectangular text object. It continues naturally across the page.`,
        ),
      ],
    }));

    const box = (id, wrap) => ({
      type: "text_box",
      attrs: {
        blockId: id,
        width: 160,
        minHeight: 80,
        wrap,
        padding: 8,
        borderWidth: 1,
        fill: "#edf1f7",
      },
      content: [
        { ...text(id + "_ALPHA"), marks: [{ type: "strong" }] },
        { type: "hard_break" },
        text(id + "_OMEGA"),
      ],
    });

    blocks[name === "edge" ? 8 : 0].content.unshift(
      box("BOXONE", name === "inline" ? "none" : "left"),
    );

    blocks[12].content.unshift(
      box("BOXTWO", name === "inline" ? "none" : "right"),
    );

    const content =
      name === "table"
        ? [
            {
              type: "table",
              content: [
                {
                  type: "table_row",
                  content: [
                    { type: "table_cell", content: blocks.slice(0, 12) },
                    { type: "table_cell", content: blocks.slice(12) },
                  ],
                },
              ],
            },
          ]
        : blocks;

    const id = await page.evaluate(
      async ({ name, content }) => {
        const p = await window.alder.request("POST", "/api/projects", {
          name: "Boxes " + name,
          template: "blank",
        });

        p.settings = {
          ...p.settings,
          documentKind: "docx",
          includeTitle: false,
          pageSize: "A5",
          marginTop: 20,
          marginBottom: 20,
          marginLeft: 20,
          marginRight: 20,
        };

        p.book = {
          version: 1,
          chapters: [
            {
              id: "main",
              title: "Text",
              include: true,
              document: { type: "doc", content },
            },
          ],
        };

        await window.alder.request("PUT", `/api/projects/${p.id}`, {
          project: p,
          expectedRevision: p.revision,
        });
        return p.id;
      },
      { name, content },
    );

    const reopen = async () => {
      await page.reload();
      await page.getByRole("button", { name: "Open", exact: true }).click();
      await page
        .locator(".project-list-item")
        .filter({ hasText: "Boxes " + name })
        .click();
    };

    await reopen();

    const editor = page.getByRole("textbox", {
        name: "Chapter text editor",
        exact: true,
      }),
      boxes = editor.locator("[data-text-box]");

    await expect(boxes).toHaveCount(2);
    await expect(page.locator(".save-status")).toHaveText("Saved");

    await editor.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 350));
    });

    if (name === "inline") {
      await boxes.first().dblclick();
      const dialog = page.getByRole("dialog", { name: "Text box properties" });

      await dialog
        .getByLabel("Text box placement", { exact: true })
        .selectOption("right");

      const story = dialog.getByRole("textbox", {
        name: "Text box text",
        exact: true,
      });

      await story.click();
      await story.press("Control+End");
      await story.press("Enter");
      await story.type("ADDED_WORD");

      await dialog.getByRole("button", { name: "Apply", exact: true }).click();

      report.dialog = (await dialog.count()) ? await dialog.innerText() : null;
      fs.writeFileSync(
        path.join(directory, "report.json"),
        JSON.stringify(report, null, 2),
      );

      await expect(boxes.first()).toContainText("ADDED_WORD");
      await expect(boxes.first()).toHaveAttribute("data-image-wrap", "right");

      await editor.press("Control+z");
      await expect(boxes.first()).not.toContainText("ADDED_WORD");

      await expect(boxes.first()).toHaveAttribute("data-image-wrap", "none");

      await expect(page.locator(".save-status")).toHaveText("Saved");
      await reopen();
      await expect(boxes).toHaveCount(2);

      await editor.locator("p").last().click({ button: "right" });

      await page.getByRole("menuitem", { name: /^Insert text box/ }).click();

      const insert = page.getByRole("dialog", { name: "Text box properties" });

      await insert
        .getByRole("textbox", { name: "Text box text", exact: true })
        .fill("NEW_BOX");

      await insert.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(boxes).toHaveCount(3);

      await editor.press("Control+z");
      await expect(boxes).toHaveCount(2);
      await expect(page.locator(".save-status")).toHaveText("Saved");
    }

    const count = await page.locator(".page-sheets > .page-sheet").count();

    expect(await editor.evaluate(overlaps)).toEqual([]);

    if (name === "wrapped")
      for (const [scale, zoom] of [
        [0.5, 0.5],
        [1.5, 3],
        [1, 0.8],
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
        await expect.poll(() => editor.evaluate(overlaps)).toEqual([]);
        await expect(page.locator(".page-sheets > .page-sheet")).toHaveCount(
          count,
        );
      }

    await page.getByRole("tab", { name: "Pages", exact: true }).click();
    await expect(page.locator(".page-card")).toHaveCount(count);

    expect(await page.locator(".page-arranger").evaluate(overlaps)).toEqual([]);

    await page.getByRole("tab", { name: "Write", exact: true }).click();

    await page.screenshot({ path: path.join(directory, name + ".png") });

    if(name === "wrapped") {
      const destination=path.join(directory,"saved-through-file-menu.docx");
      await app.evaluate(({dialog},destination)=>{
        dialog.showSaveDialog=async()=>({canceled:false,filePath:destination});
        dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});
      },destination);
      const saved=await page.evaluate(id=>window.alder.saveDocument(id,"docx","Boxes wrapped","saveAs"),id);
      expect(path.resolve(saved)).toBe(destination);
      expect(fs.statSync(destination).size).toBeGreaterThan(1000);
    }
    for (const format of ["pdf", "docx"]) {
      const exported = await page.evaluate(
        async ({ id, format }) => {
          const result = await window.alder.request(
            "POST",
            `/api/projects/${id}/export`,
            { format },
          );
          const bytes = [
            ...new Uint8Array(
              await (
                await fetch(window.alder.mediaBase + result.downloadUrl)
              ).arrayBuffer(),
            ),
          ];
          return { result, bytes };
        },
        { id, format },
      );

      const file = path.join(directory, `${name}.${format}`);
      fs.writeFileSync(file, Buffer.from(exported.bytes));

      if (format === "pdf") {
        const pdf = await getDocument({ data: new Uint8Array(exported.bytes) })
          .promise;
        let words = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const p = await pdf.getPage(i);
          words += (await p.getTextContent()).items
            .map((x) => x.str || "")
            .join("");
        }

        const compact = words.replace(/\s/g, "");

        for (let i = 0; i < 30; i++)
          expect(
            compact.split(`PASSAGE_${String(i).padStart(3, "0")}`).length - 1,
          ).toBe(1);

        for (const marker of [
          "BOXONE_ALPHA",
          "BOXONE_OMEGA",
          "BOXTWO_ALPHA",
          "BOXTWO_OMEGA",
        ])
          expect(compact.split(marker).length - 1).toBe(1);

        expect(pdf.numPages).toBe(count);
        report.cases.push({ name, pages: count });
      } else if (name === "wrapped") {
        const dest = path.resolve("work/text-boxes-word");
        fs.mkdirSync(dest, { recursive: true });
        fs.copyFileSync(file, path.join(dest, "fixture.docx"));

        fs.writeFileSync(
          path.join(dest, "fixture-exports.json"),
          JSON.stringify({
            docx: { path: path.join(dest, "fixture.docx") },
            skipListNumbers: true,
            expectedText: ["PASSAGE_000", "PASSAGE_029"],
          }),
        );
      }
    }
  }

  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack || error);
  throw error;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
