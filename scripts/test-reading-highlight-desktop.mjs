import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Exercise the production plugin in Chromium, including real layout/zoom/WAAPI.
const fixture = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
      import { Schema } from 'prosemirror-model';
      import { EditorState } from 'prosemirror-state';
      import { EditorView } from 'prosemirror-view';
      import { readingHighlight } from './frontend/src/readingHighlight';
      const schema = new Schema({nodes: {
        doc: {content: 'paragraph+'},
        paragraph: {content: 'text*', toDOM: () => ['p', 0]},
        text: {},
      }, marks: {strong: {toDOM: () => ['strong', 0]}}});
      const root = document.createElement('div');
      root.className = 'alder-app';
      root.style.cssText = 'position:fixed;inset:0;z-index:9999;background:white;display:block';
      root.innerHTML = '<div class="book-workspace"><div class="editor-scroll" style="height:650px;width:800px"><div class="test-editor-host"></div></div></div>';
      document.body.append(root);
      const host = root.querySelector('.test-editor-host');
      let reading = null, visible = true;
      const view = new EditorView(host, {state: EditorState.create({
        schema,
        plugins: [readingHighlight(() => reading, () => visible)],
      })});
      window.highlightTest = {
        view, root, host,
        load(paragraphs, marked = false) {
          reading = null;
          const content = paragraphs.map((text, i) => schema.node('paragraph', null,
            marked && i === 0 ? [schema.text(text.slice(0, 2)), schema.text(text.slice(2), [schema.marks.strong.create()])] : schema.text(text)));
          view.updateState(EditorState.create({schema, doc: schema.node('doc', null, content), plugins: view.state.plugins}));
        },
        word(start, end) {
          reading = start === null ? null : { start, end };
          view.updateState(view.state);
          return [...view.dom.querySelectorAll('.reading-word')].map(n => n.textContent).join('');
        },
        visible(value) { visible = value; view.updateState(view.state); },
        destroy() { view.destroy(); root.remove(); },
      };
    `,
  },
  bundle: true,
  format: "iife",
  write: false,
});
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-highlight-"));
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1280, 900);
    window.showInactive();
  });
  await page.getByRole("button", { name: "New", exact: true }).waitFor();
  await page.evaluate(fixture.outputFiles[0].text);
  await page.evaluate(() =>
    highlightTest.load(["Alpha bravo charlie delta echo."]),
  );
  await page.waitForTimeout(100); // Initial ResizeObserver delivery.
  const handover = await page.evaluate(() => {
    const h = highlightTest;
    h.word(0, 5);
    const text = h.word(6, 11);
    const word = h.host.querySelector(".reading-word");
    const ink = h.host.querySelector(".reading-ink");
    const animation = ink.getAnimations()[0];
    animation.pause();
    const target = word.getBoundingClientRect();
    const samples = [0, 0.25, 0.5, 0.75, 1].map((progress) => {
      animation.currentTime =
        Number(animation.effect.getTiming().duration) * progress;
      const bounds = ink.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
      };
    });
    animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
    h.word(6, 11); // Repeated status updates must not restart motion.
    const same = ink.getAnimations()[0] === animation;
    animation.finish();
    return {
      text,
      same,
      samples,
      target: {
        left: target.left,
        right: target.right,
        top: target.top,
        bottom: target.bottom,
      },
      color: getComputedStyle(ink).backgroundColor,
      shadow: getComputedStyle(word).boxShadow,
      insideDocument: h.view.dom.contains(ink),
      doc: h.view.state.doc.textContent,
    };
  });
  expect(handover).toMatchObject({
    text: "bravo",
    same: true,
    color: "rgb(229, 197, 154)",
    shadow: "none",
    insideDocument: false,
    doc: "Alpha bravo charlie delta echo.",
  });
  // The current word is fully highlighted at every frame, including time zero.
  for (const sample of handover.samples) {
    expect(sample.left).toBeLessThanOrEqual(handover.target.left + 0.1);
    expect(sample.right).toBeGreaterThanOrEqual(handover.target.right - 0.1);
    expect(sample.top).toBeLessThanOrEqual(handover.target.top + 0.1);
    expect(sample.bottom).toBeGreaterThanOrEqual(handover.target.bottom - 0.1);
  }
  expect(handover.samples[2].left).toBeGreaterThan(handover.samples[0].left);
  expect(handover.samples[2].left).toBeLessThan(handover.samples[4].left);
  expect(
    Math.abs(handover.samples[4].left - handover.target.left),
  ).toBeLessThan(0.1);
  await page.screenshot({ path: "work/reading-highlight.png" });

  for (const zoom of [0.5, 0.85, 1.25, 1.5]) {
    await page.evaluate((zoom) => {
      highlightTest.host.style.zoom = zoom;
      highlightTest.word(null);
    }, zoom);
    await page.waitForTimeout(50);
    const error = await page.evaluate(() => {
      const h = highlightTest;
      h.word(0, 5);
      h.word(6, 11);
      const focus = h.host.querySelector(".reading-ink");
      const a = focus.getAnimations()[0];
      a.pause();
      a.finish();
      return Math.abs(
        focus.getBoundingClientRect().left -
          h.host.querySelector(".reading-word").getBoundingClientRect().left,
      );
    });
    expect(error).toBeLessThan(0.15);
  }
  await page.evaluate(() => {
    highlightTest.host.style.zoom = "1";
    highlightTest.load(["Alpha bravo", "charlie delta"]);
  });
  await page.waitForTimeout(50);
  const wrap = await page.evaluate(() => {
    const h = highlightTest;
    h.word(6, 11);
    h.word(12, 19);
    const frames = h.host
      .querySelector(".reading-ink")
      .getAnimations()[0]
      .effect.getKeyframes();
    return frames.map((f) => f.transform);
  });
  expect(wrap).toEqual(["scale(1.025, 1.12)", "scale(1, 1)"]); // No sweep across unrelated text.
  await page.evaluate(() => {
    const h = highlightTest;
    h.word(0, 5); // Backward seek.
  });
  expect(
    await page
      .locator(".test-editor-host .reading-ink")
      .evaluate((e) => e.getAnimations().length),
  ).toBe(0);

  await page.evaluate(() => highlightTest.load(["Alpha bravo charlie"], true));
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => highlightTest.word(0, 5))).toBe("Alpha");
  expect(await page.locator(".test-editor-host .reading-word").count()).toBe(2);
  await page.evaluate(() => {
    highlightTest.word(6, 11);
    highlightTest.word(null);
  });
  await expect(page.locator(".test-editor-host .reading-word")).toHaveCount(0);
  expect(
    await page
      .locator(".test-editor-host .reading-ink")
      .evaluate((e) => e.getAnimations().length),
  ).toBe(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    highlightTest.word(0, 5);
    highlightTest.word(6, 11);
  });
  expect(
    await page
      .locator(".test-editor-host .reading-ink")
      .evaluate((e) => e.getAnimations().length),
  ).toBe(0);
  expect(await page.evaluate(() => highlightTest.word(12, 19))).toBe("charlie");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.evaluate(() =>
    highlightTest.load(Array(1000).fill("Alpha bravo charlie delta echo.")),
  );
  await page.waitForTimeout(100);
  const stress = await page.evaluate(() => {
    const h = highlightTest,
      original = h.view.state.doc,
      selection = h.view.state.selection;
    const started = performance.now();
    let maximum = 0;
    for (let i = 0; i < 500; i++) {
      h.word(0, 5);
      h.word(6, 11);
      maximum = Math.max(
        maximum,
        h.host.getAnimations({ subtree: true }).length,
      );
    }
    return {
      ms: performance.now() - started,
      maximum,
      nodes: h.host.querySelectorAll(".reading-ink, .reading-ink-release")
        .length,
      sameDoc: h.view.state.doc === original,
      sameSelection: h.view.state.selection === selection,
    };
  });
  expect(stress.maximum).toBeLessThanOrEqual(2);
  expect(stress.nodes).toBe(2);
  expect(stress.sameDoc && stress.sameSelection).toBe(true);
  expect(stress.ms / 1000).toBeLessThan(16);
  await page.evaluate(() => highlightTest.visible(false));
  expect(
    await page
      .locator(".test-editor-host .reading-ink")
      .evaluate((e) => e.getAnimations().length),
  ).toBe(0);
  await page.evaluate(() => highlightTest.destroy());
  await expect(page.locator(".test-editor-host")).toHaveCount(0);
  console.log("Reading highlight desktop checks passed.", stress);
} finally {
  await app.close();
}
