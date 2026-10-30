import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const directory = path.resolve(process.argv[2] || "work/tagged-pdf");
const all = [];
const descendants = (node) => [
  node,
  ...(node.children || []).flatMap(descendants),
];
const wording = (node) =>
  node.text || (node.children || []).map(wording).join("");
for (const mode of ["ordinary", "columns"]) {
  const task = getDocument({
      data: new Uint8Array(
        fs.readFileSync(path.join(directory, `${mode}.pdf`)),
      ),
    }),
    pdf = await task.promise;
  try {
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i),
        tree = await page.getStructTree(),
        content = await page.getTextContent({ includeMarkedContent: true });
      assert(tree, `Missing semantic tree on page ${i}`);
      const stack = [],
        texts = {};
      for (const item of content.items) {
        if (
          item.type === "beginMarkedContent" ||
          item.type === "beginMarkedContentProps"
        )
          stack.push(item.id || null);
        else if (item.type === "endMarkedContent") stack.pop();
        else if (item.str) {
          const key = stack.findLast((value) => value) || "untagged";
          texts[key] = (texts[key] || "") + item.str + " ";
        }
      }
      const walk = (node) =>
        node.type === "content"
          ? { ...node, text: texts[node.id] || "" }
          : { ...node, children: node.children?.map(walk) };
      pages.push({
        page: i,
        tree: walk(tree),
        texts,
        annotations: await page.getAnnotations(),
      });
    }
    const metadata = await pdf.getMetadata(),
      outline = await pdf.getOutline();
    fs.writeFileSync(
      path.join(directory, `${mode}-structure.json`),
      JSON.stringify({ metadata, outline, pages }, null, 2),
    );
    const words = pages.map((p) => wording(p.tree)).join(" "),
      nodes = pages.flatMap((p) => descendants(p.tree));
    assert.equal(metadata.info.Title, `Tagged ${mode}`);
    assert.equal(metadata.info.Language, "en-GB");
    assert(metadata.hasStructTree);
    assert.equal(outline[0].title, "HEADING_ONE");
    assert.equal(outline[0].items[0].title, "HEADING_TWO");
    assert.equal(nodes.filter((n) => n.role === "H1").length, 1);
    assert.equal(nodes.filter((n) => n.role === "H2").length, 1);
    assert.equal(
      nodes.filter((n) => n.alt === "A blue square diagram").length,
      1,
    );
    assert(!nodes.some((n) => n.alt === "DECORATIVE_ALT"));
    assert.equal(nodes.filter((n) => n.alt === "Inline diagram").length, 1);
    assert(
      nodes.some(
        (n) => n.role === "Link" && wording(n).includes("DESCRIPTIVE_LINK"),
      ),
    );
    assert(
      pages.some((p) =>
        p.annotations.some(
          (a) => a.url === "https://example.com/accessibility",
        ),
      ),
    );
    assert(!/RUNNING_HEADER|RUNNING_FOOTER/.test(words));
    for (let i = 0; i < 45; i++)
      for (const side of ["LEFT", "RIGHT"])
        assert.equal(
          words.match(
            new RegExp(`ROW_${String(i).padStart(3, "0")}_${side}`, "g"),
          )?.length,
          1,
        );
    assert.deepEqual(
      words.match(/ROW_\d{3}_(?:LEFT|RIGHT)/g),
      Array.from({ length: 45 }, (_, i) =>
        ["LEFT", "RIGHT"].map(
          (side) => `ROW_${String(i).padStart(3, "0")}_${side}`,
        ),
      ).flat(),
    );
    assert.deepEqual(
      words.match(/BODY_\d{3}/g),
      Array.from(
        { length: 70 },
        (_, i) => `BODY_${String(i).padStart(3, "0")}`,
      ),
    );
    assert.deepEqual(
      words.match(/LONG_\d{3}/g),
      Array.from(
        { length: 80 },
        (_, i) => `LONG_${String(i).padStart(3, "0")}`,
      ),
    );
    assert.equal(words.match(/FOOTNOTE_WORDS/g)?.length, 1);
    assert(wording(pages[0].tree).trim().endsWith("FOOTNOTE_WORDS"));
    const tables = nodes.filter((n) => n.role === "Table");
    for (const table of tables) {
      const content = descendants(table);
      assert(
        content.some(
          (n) =>
            n.role === "TH" &&
            n.scope === "Column" &&
            wording(n).includes("HEADER_LEFT"),
        ),
        "Continuation table lacks its column header",
      );
      assert(
        content.some(
          (n) =>
            n.role === "TH" &&
            n.scope === "Row" &&
            /ROW_\d{3}_LEFT/.test(wording(n)),
        ),
      );
    }
    all.push({
      mode,
      pages: pdf.numPages,
      tables: tables.length,
      status: "passed",
    });
  } finally {
    await task.destroy();
  }
}
fs.writeFileSync(
  path.join(directory, "semantic-report.json"),
  JSON.stringify(all, null, 2),
);
console.log(all);
