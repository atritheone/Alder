import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const directory = path.resolve(process.argv[2] || "work/note-images-ui");
const task = getDocument({
    data: new Uint8Array(fs.readFileSync(path.join(directory, "notes.pdf"))),
  }),
  pdf = await task.promise;
try {
  let text = "",
    images = 0;
  const descriptions = [];
  const walk = (node) => {
    if (node.alt) descriptions.push(node.alt);
    node.children?.forEach(walk);
  };
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    text +=
      (await page.getTextContent()).items
        .map((item) => item.str || "")
        .join(" ") + " ";
    walk(await page.getStructTree());
    images += (await page.getOperatorList()).fnArray.filter((fn) =>
      [OPS.paintImageXObject, OPS.paintInlineImageXObject].includes(fn),
    ).length;
  }
  text = text.replace(/\s+/g, " ");
  assert.equal(images, 5);
  for (const alt of [
    "Updated note image",
    "Continuation sample",
    "Endnote sample",
    "sample",
  ])
    assert.equal(
      descriptions.filter((value) => value === alt).length,
      1,
      JSON.stringify(descriptions),
    );
  assert(!descriptions.includes("Decorative sample"));
  for (let i = 0; i < 70; i++)
    assert.equal(
      text.split(`LONG_NOTE_${String(i).padStart(3, "0")}`).length - 1,
      1,
    );
  for (const wording of [
    "NOTE BEFORE",
    "NOTE AFTER",
    "END FIRST NOTE",
    "ENDNOTE BEFORE",
    "ENDNOTE AFTER",
  ])
    assert(text.includes(wording));
  const result = {
    status: "passed",
    pages: pdf.numPages,
    images,
    descriptions,
    noteLines: 70,
  };
  fs.writeFileSync(
    path.join(directory, "semantic-report.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  await task.destroy();
}
