import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [
    ".",
    "--headless-test",
    `--user-data-dir=${path.resolve(`work/raw-ui-${Date.now()}`)}`,
  ],
  env: {
    ...process.env,
    ALDER_DATA_DIR: path.resolve(`work/raw-desktop-${Date.now()}`),
  },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const writing = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(writing).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const raw = page.getByRole("button", { name: "Raw", exact: true });
  await expect(
    page
      .getByRole("toolbar", { name: "Text formatting" })
      .getByRole("button", { name: "Raw", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".page-navigation")
      .getByRole("button", { name: "Raw", exact: true }),
  ).toHaveCount(0);
  await raw.click();
  const source = page.getByRole("textbox", {
    name: "Raw text editor",
    exact: true,
  });
  await expect(source).toBeVisible();
  await expect(page.locator(".raw-mode .flow-canvas")).toBeVisible();
  await expect(page.locator(".raw-mode .page-sheet")).toHaveCount(1);
  const html =
    '<h2>Rich heading</h2><p style="text-align: center; font-family: Cambria; font-size: 18pt"><strong>Bold</strong> <em>italic</em> <u>underline</u> <s>strike</s> <sub>sub</sub> <sup>super</sup> <mark style="background:#aabbcc">highlight</mark> <a href="https://example.com">link</a></p><ul><li><p>List item</p></li></ul><table><tbody><tr><td><p>Cell</p></td><td><p>Other cell</p></td></tr></tbody></table><pre><code>const x = 1;</code></pre>';
  await source.fill(html);
  await expect(page.locator(".raw-source-error")).toHaveCount(0);
  await raw.click();
  await expect(writing.locator("h2")).toHaveText("Rich heading");
  await expect(writing.locator("table td")).toHaveCount(2);
  await expect(writing.locator("mark")).toHaveCSS(
    "background-color",
    "rgb(170, 187, 204)",
  );
  await expect(
    writing.locator("p").filter({ has: page.locator("strong") }),
  ).toHaveCSS("text-align", "center");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const before = await page.evaluate(
    async () =>
      (
        await window.alder.request(
          "GET",
          `/api/projects/${localStorage.getItem("alder.project")}`,
        )
      ).book.chapters[0].document,
  );
  await raw.click();
  expect(
    await source.evaluate((el) =>
      Array.from(el.querySelectorAll("p"))
        .map((p) => p.textContent)
        .join("\n"),
    ),
  ).toBe(html);
  await raw.click();
  const after = await page.evaluate(
    async () =>
      (
        await window.alder.request(
          "GET",
          `/api/projects/${localStorage.getItem("alder.project")}`,
        )
      ).book.chapters[0].document,
  );
  expect(after).toEqual(before);
  await raw.click();
  await source.fill(html.replace("Other cell", "Edited cell"));
  await raw.click();
  await expect(writing.locator("table")).toContainText("Edited cell");
  await expect(writing.locator("strong")).toHaveText("Bold");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await writing.click();
  await writing.press("Control+End");
  await writing.press("End");
  await writing.pressSequentially(" // edited");
  await raw.click();
  const regenerated = await source.evaluate((el) =>
    Array.from(el.querySelectorAll("p"))
      .map((p) => p.textContent)
      .join("\n"),
  );
  expect(regenerated).toContain("<table");
  expect(regenerated).toContain("Cambria");
  expect(regenerated).toContain("18pt");
  expect(regenerated).toContain("<mark");
  await source.fill(regenerated + "<script>invalid</script>");
  await expect(page.locator(".raw-source-error")).toBeVisible();
  await expect(raw).toBeDisabled();
  await source.fill(regenerated.replace("Rich heading", "Revised heading"));
  await expect(raw).toBeEnabled();
  await raw.click();
  await expect(writing.locator("h2")).toHaveText("Revised heading");
  await expect(writing.locator("table td")).toHaveCount(2);
  await expect(writing.locator("mark")).toHaveCSS(
    "background-color",
    "rgb(170, 187, 204)",
  );
  await expect(writing.locator("code")).toContainText("// edited");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const md =
    "# Markdown title\n\nAn __important__ [link][ref].\n\n[ref]: https://example.com\n";
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.items.add(new File([text], "document.md", { type: "text/markdown" }));
    window.dispatchEvent(
      new DragEvent("drop", { dataTransfer: data, bubbles: true }),
    );
  }, md);
  await expect(writing.locator("h1")).toHaveText("Markdown title");
  await raw.click();
  expect(
    await source.evaluate((el) =>
      Array.from(el.querySelectorAll("p"))
        .map((p) => p.textContent)
        .join("\n"),
    ),
  ).toBe(md);
  await source.fill(md.replace("__important__", "**changed**"));
  await raw.click();
  await expect(writing.locator("strong")).toHaveText("changed");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const saved = await page.evaluate(async () =>
    window.alder.request(
      "GET",
      `/api/projects/${localStorage.getItem("alder.project")}`,
    ),
  );
  expect(saved.book.chapters[0].rawSource.text).toContain("**changed**");
  expect(saved.settings.preferredFormat).toBe("md");
  await raw.click();
  const longSource = Array.from(
    { length: 140 },
    (_, i) =>
      `Paragraph ${i + 1}: **formatted words** and source markup stay inside the page margins. This line wraps naturally.`,
  ).join("\n");
  await source.fill(longSource);
  await expect
    .poll(() => page.locator(".raw-mode .page-sheet").count())
    .toBeGreaterThan(2);
  const pageCount = await page.locator(".raw-mode .page-sheet").count();
  const geometry = () =>
    source.evaluate((el) => {
      const canvas = el.closest(".flow-canvas");
      const sheets = [...canvas.querySelectorAll(".page-sheet")].map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const scale = el.getBoundingClientRect().width / el.offsetWidth;
      const margin =
        parseFloat(getComputedStyle(canvas).getPropertyValue("--page-margin")) *
        scale;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const failures = [];
      let node;
      while ((node = walker.nextNode())) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width < 1) continue;
          if (
            !sheets.some(
              (s) =>
                r.top >= s.y + margin - 3 &&
                r.bottom <= s.y + s.height - margin + 3,
            )
          )
            failures.push({
              top: r.top,
              bottom: r.bottom,
              text: node.textContent.slice(0, 30),
            });
        }
      }
      return { sheets, failures: failures.slice(0, 10) };
    });
  await expect.poll(async () => (await geometry()).failures).toEqual([]);
  const field = page.getByRole("spinbutton", {
    name: "Go To Page",
    exact: true,
  });
  await field.fill("2");
  await field.press("Enter");
  await expect
    .poll(() =>
      page.locator(".raw-mode .editor-scroll").evaluate((el) => el.scrollTop),
    )
    .toBeGreaterThan(500);
  await page.getByLabel("Page zoom", { exact: true }).selectOption("1.25");
  await expect
    .poll(() => page.locator(".raw-mode .page-sheet").count())
    .toBe(pageCount);
  await expect.poll(async () => (await geometry()).failures).toEqual([]);
  await page.getByLabel("Page zoom", { exact: true }).selectOption("0.8");
  await source.focus();
  await source.press("Control+End");
  await source.pressSequentially(" Tail");
  await source.press("Control+z");
  await expect(source).not.toContainText(" Tail");
  await source.press("Control+y");
  await expect(source).toContainText(" Tail");
  await source.press("Control+Home");
  await source.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "Plain ");
    data.setData("text/html", "<strong>Plain </strong>");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(source.locator("strong")).toHaveCount(0);
  expect(
    (await source.locator("p").first().textContent()).startsWith(
      "Plain Paragraph 1",
    ),
  ).toBe(true);
  await expect.poll(async () => (await geometry()).failures).toEqual([]);
  const capture = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true, stayAwake: true },
      )
    )
      .toPNG()
      .toString("base64"),
  );
  fs.writeFileSync("work/raw-pages.png", Buffer.from(capture, "base64"));
  await raw.click();
  await expect(writing.locator("strong").first()).toHaveText("formatted words");
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      ok: true,
      richHtmlEditing: true,
      noOpPreserved: true,
      markdownOriginalPreserved: true,
      markdownEditing: true,
    }),
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  const timer = setTimeout(() => app.process().kill(), 10000);
  try {
    await app.close();
  } finally {
    clearTimeout(timer);
  }
}
