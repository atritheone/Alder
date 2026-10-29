import { build } from "esbuild";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = path.resolve("work/history-performance");
fs.mkdirSync(root, { recursive: true });
await build({
  stdin: {
    contents:
      'export * from "./frontend/src/projectTimeline";export * from "./frontend/src/documentJSON";export * from "./frontend/src/editorDraft";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(root, "timeline.mjs"),
});
const { ProjectTimeline, shareProject, documentJSON, createEditorDraft } =
  await import(pathToFileURL(path.join(root, "timeline.mjs")).href);
const reports = [];
const schema = new Schema({
  nodes: {
    doc: { content: "paragraph*" },
    paragraph: { content: "text*", attrs: { blockId: { default: null } } },
    text: {},
  },
});
for (const size of [1000, 10000, 25000]) {
  let p = {
    id: "project",
    revision: 1,
    name: "Manuscript",
    settings: {},
    book: {
      chapters: [
        {
          id: "chapter",
          text: "",
          document: {
            type: "doc",
            content: Array.from({ length: size }, (_, i) => ({
              type: "paragraph",
              attrs: { blockId: "p" + i },
              content: [
                {
                  type: "text",
                  text:
                    "Paragraph " + i + " " + "Long manuscript text. ".repeat(8),
                },
              ],
            })),
          },
        },
      ],
    },
  };
  let state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON(p.book.chapters[0].document),
  });
  p.book.chapters[0].document = documentJSON(state.doc);
  const h = new ProjectTimeline();
  const durations = [];
  const serializations = [];
  for (let n = 0; n < 30; n++) {
    const start = performance.now();
    state = state.apply(
      state.tr.insertText("x", Math.floor(state.doc.content.size / 2)),
    );
    const json = documentJSON(state.doc);
    serializations.push(performance.now() - start);
    const draft = process.argv.includes("--full-clone")
      ? null
      : createEditorDraft(p);
    const next = draft?.project ?? structuredClone(p);
    next.book.chapters[0].document = json;
    const shared = shareProject(p, draft ? draft.finish() : next);
    h.record(p, shared, {
      projectId: "project",
      identity: "chapter",
      before: {},
      after: {},
      joined: n > 0,
    });
    p = shared;
    if (n >= 5) durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  reports.push({
    paragraphs: size,
    medianMs: durations[Math.floor(durations.length / 2)],
    p95Ms: durations[Math.floor(durations.length * 0.95)],
    cachedSerializationMeanMs:
      serializations.slice(5).reduce((a, b) => a + b, 0) / 25,
    patchBytes: h.retainedBytes,
    patches: h.past[0].patches.length,
  });
}
fs.writeFileSync(
  path.join(root, "report.json"),
  JSON.stringify(reports, null, 2),
);
console.log(JSON.stringify(reports, null, 2));
