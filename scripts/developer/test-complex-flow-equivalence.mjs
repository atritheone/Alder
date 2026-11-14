// Compare changed shared flow code with the frozen original algorithm. This
// protects complex layouts without treating an existing baseline defect as a
// performance regression or loosening the separate geometry acceptance test.
import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { desktopExecutable } from "../desktop-paths.mjs";
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "alder-flow-equivalence-"),
);
const originalFiles = ["Editor.tsx", "pageFlow.ts"];
const sources = path.join(directory, "frontend/src");
fs.mkdirSync(sources, { recursive: true });
fs.symlinkSync(
  path.resolve("backend"),
  path.join(directory, "backend"),
  "junction",
);
fs.symlinkSync(
  path.resolve("public"),
  path.join(directory, "public"),
  "junction",
);
for (const name of originalFiles) {
  const r = spawnSync("git", ["show", `7226aea:frontend/src/${name}`], {
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.status) throw Error("Cannot read frozen flow baseline");
  fs.writeFileSync(path.join(sources, name), r.stdout);
}
// Resolve baseline imports through the current unchanged dependency files.
// Local extensions vary (.ts/.tsx/.css), so let esbuild resolve a mirrored
// directory of links, overriding only the two files under comparison.
for (const file of fs.readdirSync("frontend/src"))
  if (!originalFiles.includes(file)) {
    if (fs.statSync(path.join("frontend/src", file)).isDirectory())
      fs.symlinkSync(
        path.resolve("frontend/src", file),
        path.join(sources, file),
        "junction",
      );
    else
      fs.copyFileSync(
        path.join("frontend/src", file),
        path.join(sources, file),
      );
  }
// The mirrored baseline shares the exact installed dependencies.
fs.symlinkSync(
  path.resolve("node_modules"),
  path.join(directory, "node_modules"),
  process.platform === "win32" ? "junction" : "dir",
);
const compile = async (baseline) =>
  (
    await build({
      entryPoints: ["scripts/layout-prototype.tsx"],
      bundle: true,
      write: false,
      outfile: path.join(directory, "probe.js"),
      format: "iife",
      jsx: "automatic",
      platform: "browser",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: baseline
        ? [
            {
              name: "baseline-editor",
              setup(builder) {
                builder.onResolve({ filter: /\/Editor$/ }, (args) => ({
                  path: path.join(sources, "Editor.tsx"),
                }));
              },
            },
          ]
        : [],
    })
  ).outputFiles[0].text;
const paragraph = (text) => ({
  type: "paragraph",
  attrs: {
    spaceAfter: 0,
    blockId: "b-" + text.slice(0, 16).replace(/[^a-z0-9]/gi, "-"),
  },
  content: [{ type: "text", text }],
});
const fixtures = [
  {
    name: "table-headers",
    content: [
      paragraph("Before table"),
      {
        type: "table",
        content: Array.from({ length: 33 }, (_, i) => ({
          type: "table_row",
          content: [0, 1].map((j) => ({
            type: i ? "table_cell" : "table_header",
            content: [paragraph(`Row ${i} cell ${j}`)],
          })),
        })),
      },
      paragraph("After table"),
    ],
  },
  {
    name: "continuous-sections",
    content: Array.from({ length: 180 }, (_, i) => [
      ...([20, 65, 110].includes(i)
        ? [
            {
              type: "section_break",
              attrs: {
                kind: "continuous",
                page: {
                  pageSize: "A4",
                  marginTopMm: 22,
                  marginLeftMm: i === 65 ? 35 : 22,
                  marginBottomMm: 22,
                  marginRightMm: 22,
                },
              },
            },
          ]
        : []),
      paragraph(`Passage ${i}. ` + "A short original line for pagination."),
    ]).flat(),
  },
  {
    name: "columns-mirrored-margins",
    layout: {
      columns: { count: 2, gapMm: 8 },
      mirrorMargins: true,
      margins: { top: 65, bottom: 75, left: 95, right: 50 },
    },
    content: Array.from({ length: 80 }, (_, i) =>
      paragraph(
        `Column ${i}. ` +
          "A continuous passage spanning columns and mirrored pages. ".repeat(
            5,
          ),
      ),
    ),
  },
  {
    name: "footnotes",
    content: Array.from({ length: 90 }, (_, i) => ({
      type: "paragraph",
      attrs: { blockId: "note-p-" + i },
      content: [
        {
          type: "text",
          text:
            `Passage ${i}. ` +
            "Text surrounding a note in a published document. ".repeat(5),
        },
        ...(i % 17 === 0
          ? [
              {
                type: "document_note",
                attrs: {
                  blockId: "note-" + i,
                  kind: "footnote",
                  body: { type: "doc", content: [paragraph("Footnote " + i)] },
                },
              },
            ]
          : []),
      ],
    })),
  },
];
const report = { status: "running", checks: [] };
let app;
try {
  const compiled = {
    baseline: await compile(true),
    candidate: await compile(false),
  };
  for (const fixture of fixtures) {
    let expected;
    for (const label of ["baseline", "candidate"]) {
      const profile = path.join(directory, fixture.name + "-" + label);
      app = await electron.launch({
        executablePath: desktopExecutable(),
        args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
        env: { ...process.env, ALDER_DATA_DIR: profile + "/data" },
      });
      console.log(fixture.name, label);
      const page = await app.firstWindow();
      page.on("pageerror", (e) => console.log("pageerror", e.message));
      page.on("console", (m) => {
        if (m.type() === "error") console.log(m.text());
      });
      await expect(
        page.getByRole("button", { name: "New", exact: true }),
      ).toBeVisible();
      await page.evaluate(compiled[label]);
      await page.addStyleTag({ path: "frontend/src/book-workspace.css" });
      const results = [];
      for (const [scale, zoom] of [
        [1, 1],
        [0.5, 0.5],
        [1.5, 3],
      ]) {
        await page.evaluate(
          ({ fixture, scale, zoom }) => {
            const p = window.__layoutProbe;
            p.scale(scale);
            p.zoom(zoom);
            p.pageSize({
              width: 794,
              height: 1123,
              margin: 75,
              ...fixture.layout,
            });
            p.document({ type: "doc", content: fixture.content });
          },
          { fixture, scale, zoom },
        );
        await page.evaluate(() => document.fonts.ready);
        await expect
          .poll(
            () =>
              page.evaluate(() => {
                try {
                  return window.__layoutProbe.pages().length;
                } catch {
                  return 0;
                }
              }),
            { timeout: 30000 },
          )
          .toBeGreaterThan(0);
        await expect
          .poll(
            async () => {
              try {
                await page.evaluate(() => window.__layoutProbe.capture());
                return true;
              } catch {
                return false;
              }
            },
            { timeout: 30000 },
          )
          .toBe(true);
        results.push(
          await page.evaluate(() => {
            const capture = window.__layoutProbe.capture();
            // The printable page map and text are the complete output contract here;
            // view-only widget keys and random generated node identities are excluded.
            return JSON.parse(
              JSON.stringify(capture.pages, (key, value) =>
                typeof value === "number"
                  ? Math.round(value * 1000) / 1000
                  : value,
              ),
            );
          }),
        );
      }
      if (label === "baseline") expected = results;
      else expect(results, fixture.name).toEqual(expected);
      await app.close();
      app = null;
    }
    report.checks.push({
      fixture: fixture.name,
      scales: 3,
      exactBaselineOutput: true,
    });
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  await app?.close();
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ ...report, directory }));
}
