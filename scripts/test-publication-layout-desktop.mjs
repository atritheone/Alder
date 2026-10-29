import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/publication-layout");
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(
  path.join(os.tmpdir(), "alder-publication-layout-"),
);
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "fixture.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const report = { status: "running", cases: [], errors: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  app.on("window", (window) =>
    window.on("pageerror", (error) => report.errors.push(error.message)),
  );
  page = await app.firstWindow();
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    fs.readFileSync(path.join(directory, "fixture.js"), "utf8"),
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        try {
          return window.__layoutProbe.capture().pages.length;
        } catch {
          return 0;
        }
      }),
    )
    .toBeGreaterThan(1);
  for (const label of ["ordinary", "mixed-sections", "rich-content"]) {
    await page.evaluate(async () => {
      window.publicationProject = await window.alder.request(
        "POST",
        "/api/projects",
        { template: "blank", name: "Shared page layout" },
      );
    });
    if (label === "mixed-sections")
      await page.evaluate(() => {
        const doc = window.__layoutProbe.doc();
        window.__layoutProbe.document({
          ...doc,
          content: [
            ...doc.content,
            {
              type: "section_break",
              attrs: {
                kind: "oddPage",
                page: {
                  pageSize: "A5",
                  orientation: "landscape",
                  marginMm: 15,
                },
              },
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text:
                    "MIXED_SECTION_END " +
                    "Text in the second section. ".repeat(80),
                },
              ],
            },
          ],
        });
      });
    if (label === "rich-content")
      await page.evaluate(async () => {
        const project = window.publicationProject;
        const canvas = document.createElement("canvas");
        canvas.width = 120;
        canvas.height = 60;
        const context = canvas.getContext("2d");
        context.fillStyle = "#aa0000";
        context.fillRect(0, 0, 120, 60);
        context.fillStyle = "#23405e";
        context.fillRect(30, 0, 60, 60);
        const bytes = [
          ...Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (c) =>
            c.charCodeAt(0),
          ),
        ];
        const asset = await window.alder.upload(
          `/api/projects/${project.id}/assets`,
          "Publication.png",
          bytes,
          {},
        );
        window.publicationProject = await window.alder.request(
          "GET",
          `/api/projects/${project.id}`,
        );
        const text = (value) => ({ type: "text", text: value });
        const paragraph = (value, attrs = {}) => ({
          type: "paragraph",
          attrs,
          content: typeof value === "string" ? [text(value)] : value,
        });
        const image = {
          assetId: asset.id,
          src: asset.url,
          width: 120,
          alt: "Blue centre",
          crop: { left: 25, right: 25, top: 0, bottom: 0 },
        };
        window.__layoutProbe.document({
          type: "doc",
          content: [
            paragraph([
              {
                ...text("Jump to the destination"),
                marks: [{ type: "link", attrs: { href: "#Destination" } }],
              },
            ]),
            paragraph([
              text("Before picture "),
              { type: "inline_image", attrs: image },
              text(" after picture."),
            ]),
            { type: "image", attrs: { ...image, width: 240 } },
            paragraph("Left\tCentre\tRight", {
              tabStops: [
                { position: 120, align: "center", leader: "dot" },
                { position: 300, align: "right", leader: "dash" },
              ],
            }),
            paragraph("Decorated exact leading", {
              lineSpacingMode: "exact",
              lineSpacing: 25,
              paragraphBackground: "#ddeeff",
              paragraphBorderColor: "#23405e",
              paragraphBorderWidth: 1,
              paragraphPadding: 4,
            }),
            paragraph([
              text(
                Array.from(
                  { length: 120 },
                  (_, i) =>
                    `SPLIT${String(i).padStart(4, "0")} A paragraph crosses several printed pages. `,
                ).join(""),
              ),
              {
                type: "bookmark",
                attrs: {
                  name: "Destination",
                  blockId: "destination",
                  range: true,
                },
              },
              text("DESTINATION_WORDS"),
              {
                type: "bookmark_end",
                attrs: { targetId: "destination", name: "Destination" },
              },
              text(" More following words. ".repeat(25)),
            ]),
            paragraph([
              {
                type: "cross_reference",
                attrs: { targetId: "destination" },
                content: [text("DESTINATION_WORDS")],
              },
            ]),
            paragraph("RICH_CONTENT_END"),
          ],
        });
        await Promise.all(
          [...document.querySelectorAll("img")].map((image) => image.decode()),
        );
      });
    await expect
      .poll(() =>
        page.evaluate((label) => {
          try {
            const pages = window.__layoutProbe.pages();
            const text = pages.map((page) => page.text).join(" ");
            return (
              pages.length > 1 &&
              (label === "ordinary" ||
                text.includes(
                  label === "mixed-sections"
                    ? "MIXED_SECTION_END"
                    : "RICH_CONTENT_END",
                ))
            );
          } catch {
            return false;
          }
        }, label),
      )
      .toBe(true);
    const expected = await page.evaluate(() => window.__layoutProbe.capture());
    const result = await page.evaluate(async () => {
      let project = window.publicationProject;
      Object.assign(project.settings, {
        documentKind: "docx",
        fontFamily: "Cambria",
        fontSize: 12,
        lineHeight: 1.5,
        pageSize: "A4",
        marginMm: 20,
        footer: false,
        includeTitle: false,
        includeToc: false,
      });
      project.styles = [];
      project.book = {
        version: 1,
        chapters: [
          {
            id: "chapter",
            title: "Document",
            include: true,
            document: window.__layoutProbe.doc(),
          },
        ],
      };
      project = await window.alder.request(
        "PUT",
        `/api/projects/${project.id}`,
        { project, expectedRevision: project.revision },
      );
      const source = JSON.stringify(project.book);
      const result = await window.alder.request(
        "POST",
        `/api/projects/${project.id}/export`,
        { format: "pdf" },
      );
      const after = await window.alder.request(
        "GET",
        `/api/projects/${project.id}`,
      );
      if (JSON.stringify(after.book) !== source)
        throw new Error("Publication changed the authored document.");
      const response = await fetch(window.alder.mediaBase + result.downloadUrl);
      return { result, pdf: [...new Uint8Array(await response.arrayBuffer())] };
    });
    expect(result.result.validation).toMatchObject({
      status: "passed",
      layoutEngine: "alder-page-map",
      pages: expected.pages.length,
    });
    fs.writeFileSync(
      path.join(directory, `${label}.pdf`),
      Buffer.from(result.pdf),
    );
    report.cases.push({
      label,
      expected: expected.pages,
      result: result.result,
    });
    fs.writeFileSync(
      path.join(directory, "report.json"),
      JSON.stringify(report, null, 2),
    );
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close().catch(() => {});
}
