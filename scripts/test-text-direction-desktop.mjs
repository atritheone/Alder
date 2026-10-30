import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/text-direction-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-text-direction-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", errors: [], checks: [] };
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
  const fixture = JSON.parse(
    fs.readFileSync("work/text-direction-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Text direction desktop",
      template: "blank",
    });
    p.book = fixture.book;
    p.settings = { ...p.settings, ...fixture.settings };
    p.styles.push({
      id: "hebrew",
      name: "Hebrew",
      kind: "paragraph",
      textDirection: "rtl",
      textLanguage: "he",
    });
    p.book.chapters[0].document.content[2].attrs = {
      styleId: "hebrew",
      spaceAfter: 10,
    };
    await window.alder.request("PUT", `/api/projects/${p.id}`, {
      project: p,
      expectedRevision: p.revision,
    });
    return p.id;
  }, fixture);
  const reopen = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: "Text direction desktop" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    paras = editor.locator(":scope>p");
  await expect(paras.nth(1)).toHaveAttribute("dir", "rtl");
  await expect(paras.nth(2)).toHaveAttribute("dir", "rtl");
  await expect(paras.nth(2)).toHaveAttribute("lang", "he");
  await paras.first().click();
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Paragraph…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Paragraph", exact: true });
  await dialog.getByText("Language and direction", { exact: true }).click();
  await dialog
    .getByLabel("Paragraph direction", { exact: true })
    .selectOption("rtl");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(paras.first()).toHaveAttribute("dir", "rtl");
  await page.keyboard.press("Control+z");
  await expect(paras.first()).toHaveAttribute("dir", "ltr");
  // A 144pt RTL tab is measured from the right text margin; its following
  // right-aligned Arabic word starts at that stop and extends to the left.
  await expect
    .poll(async () =>
      paras.last().evaluate((p) => {
        const tab = p.querySelector("[data-alder-tab]");
        return tab ? parseFloat(getComputedStyle(tab).width) : 0;
      }),
    )
    .toBeGreaterThan(50);
  report.rtlTab = await paras.last().evaluate((p) => {
    const r = p.getBoundingClientRect(),
      scale = r.width / p.offsetWidth,
      tab = p.querySelector("[data-alder-tab]"),
      range = document.createRange();
    range.selectNodeContents(p.lastChild);
    const word = range.getBoundingClientRect();
    return {
      direction: getComputedStyle(p).direction,
      stopPoints: ((r.right - word.right) / scale) * 0.75,
      tabWidth: parseFloat(getComputedStyle(tab).width),
    };
  });
  expect(report.rtlTab.stopPoints).toBeCloseTo(144, 0);
  report.checks.push(
    "Direct/inherited paragraph direction, language, undo and RTL tab geometry",
  );
  await paras.last().click();
  await page.evaluate(() => {
    localStorage.setItem("alder.ruler", "true");
    window.dispatchEvent(new Event("alder-ruler"));
  });
  const ruler = page.getByLabel("Paragraph ruler in points");
  const tab = ruler.getByRole("button", {
    name: "right tab at 144 points",
    exact: true,
  });
  await expect(tab).toBeVisible();
  const before = await tab.boundingBox();
  await tab.focus();
  await page.keyboard.press("ArrowLeft");
  const moved = ruler.getByRole("button", {
    name: "right tab at 145 points",
    exact: true,
  });
  await expect(moved).toBeVisible();
  expect((await moved.boundingBox()).x).toBeLessThan(before.x);
  await moved.focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab).toBeVisible();
  const firstIndent = ruler.getByRole("button", {
    name: "First line indent: 0 points",
    exact: true,
  });
  await firstIndent.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(
    ruler.getByRole("button", {
      name: "First line indent: 1 points",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(firstIndent).toBeVisible();
  report.checks.push(
    "RTL ruler keyboard changes follow physical arrow direction and preserve tab stops",
  );
  // Real Chromium composition events, including a replacement of an in-flight
  // candidate, followed by commit. Nothing is written twice during reflow.
  await paras.nth(3).click();
  await page.keyboard.press("End");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "にほん",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await cdp.send("Input.imeSetComposition", {
    text: "日本",
    selectionStart: 2,
    selectionEnd: 2,
  });
  await cdp.send("Input.insertText", { text: "日本" });
  await expect(paras.nth(3)).toContainText("日本語の文章と English 123。日本");
  await expect(paras.nth(3)).not.toContainText("にほん");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.screenshot({ path: path.join(directory, "multilingual.png") });
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
    path.join(directory, "multilingual.pdf"),
    Buffer.from(pdf.bytes),
  );
  expect(pdf.result.validation.pages).toBe(1);
  await reopen();
  await expect(paras.nth(3)).toHaveText("日本語の文章と English 123。日本");
  await expect(paras.nth(1)).toHaveAttribute("dir", "rtl");
  report.checks.push(
    "CJK composition replacement/commit, mixed-script PDF, save/reopen and logical text preservation",
  );
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.error = error.stack;
  await page
    ?.screenshot({ path: path.join(directory, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
