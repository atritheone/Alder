import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/tagged-pdf"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-tagged-pdf-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", results: [], errors: [] };
let app, page;
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
  const image = JSON.parse(
    fs.readFileSync("work/running-images-word/fixture-project.json", "utf8"),
  ).assets[0].data;
  for (const mode of ["ordinary", "columns", "empty"]) {
    const result = await page.evaluate(
      async ({ image, mode }) => {
        const p = await window.alder.request("POST", "/api/projects", {
          name: `Tagged ${mode}`,
          template: "blank",
        });
        const asset = await window.alder.upload(
          `/api/projects/${p.id}/assets?register=false`,
          "Diagram.png",
          [...Uint8Array.from(atob(image), (c) => c.charCodeAt(0))],
          {},
        );
        const text = (value) => ({ type: "text", text: value }),
          para = (value) => ({ type: "paragraph", content: [text(value)] }),
          doc = (...content) => ({ type: "doc", content });
        p.assets = [asset];
        p.language = "en-GB";
        p.settings.documentKind = "docx";
        p.settings.includeTitle = false;
        p.settings.footer = true;
        if (mode === "columns")
          p.settings.columns = { count: 2, gapMm: 12, separator: true };
        p.settings.runningMatter = {
          header: { default: doc(para("RUNNING_HEADER")) },
          footer: { default: doc(para("RUNNING_FOOTER")) },
        };
        const cell = (kind, content) => ({
          type: kind,
          content: [para(content)],
        });
        p.book = {
          version: 1,
          chapters: [
            {
              id: "text",
              title: "Text",
              include: true,
              document: doc(
                {
                  type: "heading",
                  attrs: { level: 1 },
                  content: [text("HEADING_ONE")],
                },
                para("INTRO_ONE"),
                {
                  type: "paragraph",
                  content: [
                    {
                      ...text("DESCRIPTIVE_LINK"),
                      marks: [
                        {
                          type: "link",
                          attrs: { href: "https://example.com/accessibility" },
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "image",
                  attrs: {
                    assetId: asset.id,
                    src: `/api/projects/${p.id}/assets/${asset.id}`,
                    alt: "A blue square diagram",
                    width: 80,
                  },
                },
                {
                  type: "image",
                  attrs: {
                    assetId: asset.id,
                    src: `/api/projects/${p.id}/assets/${asset.id}`,
                    alt: "DECORATIVE_ALT",
                    decorative: true,
                    width: 20,
                  },
                },
                {
                  type: "paragraph",
                  content: [
                    text("NOTE_ANCHOR"),
                    {
                      type: "document_note",
                      attrs: {
                        kind: "footnote",
                        body: doc(para("FOOTNOTE_WORDS")),
                      },
                    },
                  ],
                },
                {
                  type: "table",
                  content: [
                    {
                      type: "table_row",
                      content: [
                        cell("table_header", "HEADER_LEFT"),
                        cell("table_header", "HEADER_RIGHT"),
                      ],
                    },
                    ...Array.from({ length: 45 }, (_, i) => ({
                      type: "table_row",
                      content: [
                        cell(
                          "table_header",
                          `ROW_${String(i).padStart(3, "0")}_LEFT`,
                        ),
                        cell(
                          "table_cell",
                          `ROW_${String(i).padStart(3, "0")}_RIGHT`,
                        ),
                      ],
                    })),
                  ],
                },
                {
                  type: "heading",
                  attrs: { level: 2 },
                  content: [text("HEADING_TWO")],
                },
                {
                  type: "paragraph",
                  attrs: { textLanguage: "fr" },
                  content: [text("Bonjour le monde.")],
                },
                ...Array.from({ length: 70 }, (_, i) =>
                  para(
                    `BODY_${String(i).padStart(3, "0")} Some authored words in a paragraph.`,
                  ),
                ),
                {
                  type: "paragraph",
                  content: Array.from({ length: 80 }, (_, i) => [
                    text(
                      `LONG_${String(i).padStart(3, "0")} Spanning paragraph.`,
                    ),
                    ...(i === 40
                      ? [
                          {
                            type: "inline_image",
                            attrs: {
                              assetId: asset.id,
                              src: `/api/projects/${p.id}/assets/${asset.id}`,
                              alt: "Inline diagram",
                              width: 25,
                            },
                          },
                        ]
                      : []),
                    { type: "hard_break" },
                  ]).flat(),
                },
                para("FINAL_WORDS"),
              ),
            },
          ],
        };
        if (mode === "empty")
          p.book.chapters[0].document = doc({ type: "paragraph" });
        await window.alder.request("PUT", `/api/projects/${p.id}`, {
          project: p,
          expectedRevision: p.revision,
        });
        const exported = await window.alder.request(
          "POST",
          `/api/projects/${p.id}/export`,
          { format: "pdf" },
        );
        return {
          validation: exported.validation,
          bytes: [
            ...new Uint8Array(
              await (
                await fetch(window.alder.mediaBase + exported.downloadUrl)
              ).arrayBuffer(),
            ),
          ],
        };
      },
      { image, mode },
    );
    fs.writeFileSync(
      path.join(directory, `${mode}.pdf`),
      Buffer.from(result.bytes),
    );
    expect(result.validation.tagged).toBe(mode !== "empty");
    report.results.push({ mode, validation: result.validation });
  }
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  throw error;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
