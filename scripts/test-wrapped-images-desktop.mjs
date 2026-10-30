import { _electron as electron, expect } from "@playwright/test";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = path.resolve("work/wrapped-images-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-wrapped-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", cases: [], errors: [] };
let app, page;
// Run in the actual editor, Arrangement copies and frozen print document.
const overlaps = (root) => {
  const images = [...root.querySelectorAll("img[data-asset-id]")]
    .filter((image) => getComputedStyle(image).visibility !== "hidden")
    .map((image) => ({ image, rect: image.getBoundingClientRect() }));
  const failures = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode,
      element = node.parentElement;
    if (
      !node.textContent.trim() ||
      getComputedStyle(element).visibility === "hidden" ||
      element.closest(
        '.structure-marker,.pagination-spacer,.page-furniture,[aria-hidden="true"]',
      )
    )
      continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects())
      for (const image of images) {
        const commonSheet = image.image.closest(
          ".publication-sheet,.page-snapshot",
        );
        if (commonSheet && !commonSheet.contains(node)) continue;
        if (
          Math.min(rect.right, image.rect.right) -
            Math.max(rect.left, image.rect.left) >
            1 &&
          Math.min(rect.bottom, image.rect.bottom) -
            Math.max(rect.top, image.rect.top) >
            1
        )
          failures.push({
            text: node.textContent.slice(0, 35),
            image: image.image.alt,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
          });
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
  await app.evaluate(({ app }, check) => {
    app.on("web-contents-created", (_event, contents) => {
      const print = contents.printToPDF.bind(contents);
      contents.printToPDF = async (options) => {
        globalThis.__wrappedPrint = await contents.executeJavaScript(
          `({html:document.documentElement.outerHTML,overlaps:(${check})(document.body)})`,
        );
        return print(options);
      };
    });
  }, overlaps.toString());
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const original = JSON.parse(
    fs.readFileSync("work/wrapped-images-word/fixture-project.json", "utf8"),
  );
  for (const name of [
    "body",
    "edge",
    "long",
    "columns",
    "table",
    "last",
    "table-block",
    "merged-pictures",
  ]) {
    report.stage = name;
    fs.writeFileSync(
      path.join(directory, "report.json"),
      JSON.stringify(report, null, 2),
    );
    const fixture = structuredClone(original),
      blocks = fixture.book.chapters[0].document.content;
    if (name === "edge") {
      const image = blocks[0].content.shift();
      image.attrs.width = 180;
      blocks[8].content.unshift(image);
    }
    if (name === "long")
      blocks[0].content[1].text +=
        " Long prose continues past the picture and through the following physical page.".repeat(
          90,
        );
    if (name === "columns") {
      fixture.settings.pageSize = "A4";
      fixture.settings.columns = { count: 2, gapMm: 8 };
    }
    if (
      name === "table" ||
      name === "table-block" ||
      name === "merged-pictures"
    )
      fixture.book.chapters[0].document.content = [
        {
          type: "table",
          content: [
            {
              type: "table_row",
              content: [
                {
                  type: "table_cell",
                  attrs: {
                    colwidth: [204],
                    paddingTop: 2,
                    paddingBottom: 2,
                    paddingLeft: 2,
                    paddingRight: 2,
                  },
                  content: blocks.slice(0, 12),
                },
                {
                  type: "table_cell",
                  attrs: {
                    colwidth: [204],
                    paddingTop: 2,
                    paddingBottom: 2,
                    paddingLeft: 2,
                    paddingRight: 2,
                  },
                  content: blocks.slice(12),
                },
              ],
            },
          ],
        },
      ];
    if (name === "table-block") {
      for (const cell of fixture.book.chapters[0].document.content[0].content[0]
        .content)
        cell.content = cell.content.flatMap((p) => {
          if (p.content[0]?.type !== "inline_image") return [p];
          const image = p.content.shift();
          image.type = "image";
          image.attrs.wrap = "none";
          return [image, p];
        });
    }
    if (name === "merged-pictures") {
      blocks[0].content[1].text = "PASSAGE_000 Short anchored paragraph.";
      blocks[1].content[0].text = "PASSAGE_001 Last words.";
      const table = fixture.book.chapters[0].document.content[0],
        left = table.content[0].content[0],
        right = table.content[0].content[1];
      left.attrs.rowspan = 2;
      left.attrs.verticalAlign = "bottom";
      left.content = blocks.slice(0, 2);
      right.content = blocks.slice(2, 16);
      table.content.push({
        type: "table_row",
        content: [
          {
            type: "table_cell",
            attrs: { ...right.attrs },
            content: blocks.slice(16),
          },
        ],
      });
    }
    if (name === "last") {
      const image = blocks[0].content.shift();
      blocks.push({ type: "paragraph", content: [image] });
    }
    const id = await page.evaluate(
      async ({ fixture, name }) => {
        const p = await window.alder.request("POST", "/api/projects", {
          name: "Wrapped " + name,
          template: "blank",
        });
        const asset = await window.alder.upload(
          `/api/projects/${p.id}/assets?register=false`,
          "sample.png",
          [
            ...Uint8Array.from(atob(fixture.assets[0].data), (c) =>
              c.charCodeAt(0),
            ),
          ],
          {},
        );
        p.assets = [asset];
        const remap = (n) => {
          if (["image", "inline_image"].includes(n.type)) {
            n.attrs.assetId = asset.id;
            n.attrs.src = `/api/projects/${p.id}/assets/${asset.id}`;
          }
          n.content?.forEach(remap);
        };
        fixture.book.chapters.forEach((c) => remap(c.document));
        p.book = fixture.book;
        p.settings = fixture.settings;
        await window.alder.request("PUT", `/api/projects/${p.id}`, {
          project: p,
          expectedRevision: p.revision,
        });
        return p.id;
      },
      { fixture, name },
    );
    const reopen = async () => {
      await page.reload();
      await page.getByRole("button", { name: "Open", exact: true }).click();
      await page
        .locator(".project-list-item")
        .filter({ hasText: "Wrapped " + name })
        .click();
    };
    await reopen();
    const editor = page.getByRole("textbox", {
        name: "Chapter text editor",
        exact: true,
      }),
      images = editor.locator("img[data-asset-id]");
    await expect(images).toHaveCount(2);
    await expect(page.locator(".save-status")).toHaveText("Saved");
    await expect
      .poll(() =>
        images.evaluateAll((images) =>
          images.every((image) => image.complete && image.naturalWidth > 0),
        ),
      )
      .toBe(true);
    await editor.evaluate(async (root) => {
      await document.fonts.ready;
      await Promise.all(
        [...root.querySelectorAll("img[data-image-wrap]")].map((image) =>
          image.decode(),
        ),
      );
      await new Promise((resolve, reject) => {
        const deadline = performance.now() + 15000;
        let signature = "",
          since = 0;
        const frame = () => {
          const now = performance.now(),
            next = JSON.stringify([
              document.querySelectorAll(".page-sheets > .page-sheet").length,
              root.getBoundingClientRect().height,
              ...[...root.querySelectorAll("img[data-image-wrap]")].map(
                (image) => image.getBoundingClientRect().top,
              ),
            ]);
          if (next !== signature) {
            signature = next;
            since = now;
          }
          if (now - since >= 200) resolve();
          else if (now > deadline)
            reject(new Error("Wrapped picture layout did not settle."));
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    });
    if (name === "body") {
      await images.first().dblclick();
      let dialog = page.getByRole("dialog", {
        name: "Image properties",
        exact: true,
      });
      await expect(dialog.getByLabel("Image placement")).toHaveValue("left");
      await dialog.getByLabel("Image placement").selectOption("right");
      await dialog.getByLabel("Image text spacing (mm)").fill("6");
      await dialog.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(images.first()).toHaveAttribute("data-image-wrap", "right");
      await page.keyboard.press("Control+z");
      await expect(images.first()).toHaveAttribute("data-image-wrap", "left");
      // The text beside a float remains editable at its displayed caret position.
      await editor.locator("p").nth(1).scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const point = await editor.evaluate((root) => {
        const text = [...root.querySelectorAll("p")][1];
        const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode,
            at = node.textContent.indexOf("PASSAGE_001");
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at + 4);
          range.setEnd(node, at + 4);
          const r = range.getBoundingClientRect();
          return { x: r.x, y: (r.top + r.bottom) / 2 };
        }
      });
      await page.mouse.click(point.x, point.y);
      report.click = await page.evaluate((point) => {
        const selection = getSelection(),
          caret = document.caretRangeFromPoint(point.x, point.y);
        return {
          point,
          target: document
            .elementFromPoint(point.x, point.y)
            ?.outerHTML.slice(0, 500),
          selection: selection?.anchorNode?.textContent?.slice(0, 100),
          offset: selection?.anchorOffset,
          caret: caret?.startContainer?.textContent?.slice(0, 100),
          caretOffset: caret?.startOffset,
        };
      }, point);
      await page.keyboard.type("Q");
      await expect(editor).toContainText("PASSQAGE_001");
      await page.keyboard.press("Control+z");
      await expect(editor).not.toContainText("PASSQAGE");
      await expect(page.locator(".save-status")).toHaveText("Saved");
      await reopen();
      await expect(images.first()).toHaveAttribute("data-image-wrap", "left");
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
        await expect(page.locator(".page-sheets > .page-sheet")).toHaveCount(3);
      }
    }
    const geometry = await images.evaluateAll(
      (images, height) => {
        const sheets = [
          ...document.querySelectorAll(".page-sheets > .page-sheet"),
        ].map((sheet) => sheet.getBoundingClientRect());
        return images.map((image) => {
          const r = image.getBoundingClientRect();
          return {
            alt: image.alt,
            page: sheets.findIndex(
              (sheet) =>
                r.top >= sheet.top + (20 / height) * sheet.height - 1 &&
                r.bottom <= sheet.bottom - (20 / height) * sheet.height + 1,
            ),
          };
        });
      },
      name === "columns" ? 297 : 210,
    );
    expect(geometry.every((image) => image.page >= 0)).toBe(true);
    if (name === "edge") expect(geometry[0].page).toBeGreaterThan(0);
    expect(await editor.evaluate(overlaps)).toEqual([]);
    const count = await page.locator(".page-sheets > .page-sheet").count();
    await page.getByRole("tab", { name: "Pages", exact: true }).click();
    await expect(page.locator(".page-card")).toHaveCount(count);
    expect(await page.locator(".page-arranger").evaluate(overlaps)).toEqual([]);
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
    fs.writeFileSync(
      path.join(directory, name + ".pdf"),
      Buffer.from(pdf.bytes),
    );
    const printed = await app.evaluate(() => globalThis.__wrappedPrint);
    fs.writeFileSync(path.join(directory, name + ".html"), printed.html);
    expect(printed.overlaps).toEqual([]);
    const document = await getDocument({
      data: Uint8Array.from(pdf.bytes),
      useSystemFonts: true,
    }).promise;
    let text = "",
      drawings = 0;
    for (let i = 1; i <= document.numPages; i++) {
      text +=
        (await (await document.getPage(i)).getTextContent()).items
          .map((item) => item.str || "")
          .join(" ") + " ";
      drawings += (
        await (await document.getPage(i)).getOperatorList()
      ).fnArray.filter((op) =>
        [OPS.paintImageXObject, OPS.paintInlineImageXObject].includes(op),
      ).length;
    }
    expect(drawings).toBe(2);
    for (let i = 0; i < 30; i++)
      expect(
        text
          .replace(/\s/g, "")
          .match(new RegExp("PASSAGE_" + String(i).padStart(3, "0"), "g"))
          ?.length,
      ).toBe(1);
    expect(pdf.result.validation.pages).toBe(count);
    if(name==='table-block'){
      const word=await page.evaluate(async id=>{const result=await window.alder.request('POST',`/api/projects/${id}/export`,{format:'docx'});return {result,bytes:[...new Uint8Array(await(await fetch(window.alder.mediaBase+result.downloadUrl)).arrayBuffer())]};},id);
      expect(word.result.warnings.some(warning=>warning.includes('taller than a page'))).toBe(true);
      const destination=path.resolve('work/table-pictures-measured-word');fs.mkdirSync(destination,{recursive:true});
      const file=path.join(destination,'pictures.docx');fs.writeFileSync(file,Buffer.from(word.bytes));
      fs.writeFileSync(path.join(destination,'fixture-exports.json'),JSON.stringify({docx:{path:file},skipListNumbers:true,expectedText:['PASSAGE_000','PASSAGE_029']}));
      report.wordWarnings=word.result.warnings;
    }
    report.cases.push({ name, pages: count, geometry });
  }
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
