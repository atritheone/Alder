import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [
    ".",
    "--headless-test",
    `--user-data-dir=${path.resolve(`work/workspace-ui-${Date.now()}`)}`,
  ],
  env: {
    ...process.env,
    ALDER_DATA_DIR: path.resolve(`work/workspace-desktop-${Date.now()}`),
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
  const project = await page.evaluate(() =>
    window.alder.request(
      "GET",
      `/api/projects/${localStorage.getItem("alder.project")}`,
    ),
  );
  expect(project.clips).toHaveLength(1);
  expect(project.clips[0].text).toBe("");
  const left = page.getByRole("button", {
    name: "Toggle Left Panel",
    exact: true,
  });
  if ((await left.getAttribute("aria-expanded")) === "true") await left.click();
  const centre = await page
    .locator(".paginated-editor .editor-scroll")
    .evaluate((el) => {
      const box = el.getBoundingClientRect(),
        sheet = el.querySelector(".page-sheet").getBoundingClientRect();
      return {
        left: sheet.left - box.left,
        right: box.right - sheet.right,
        width: el.clientWidth,
        css: getComputedStyle(el).cssText,
        canvas: el.querySelector(".flow-canvas").getAttribute("style"),
      };
    });

  expect(Math.abs(centre.left - centre.right)).toBeLessThan(5);
  await writing.fill(
    "The page stays centered as the manuscript grows. ".repeat(200),
  );
  await expect
    .poll(() => page.locator(".page-sheet").count())
    .toBeGreaterThan(1);
  await page.getByRole("spinbutton", { name: "Go To Page" }).fill("2");
  await page.getByRole("spinbutton", { name: "Go To Page" }).press("Enter");
  await expect
    .poll(() =>
      page.locator(".paginated-editor .editor-scroll").evaluate((el) => {
        const box = el.getBoundingClientRect(),
          sheet = el.querySelectorAll(".page-sheet")[1].getBoundingClientRect();
        return Math.abs(sheet.left - box.left - (box.right - sheet.right));
      }),
    )
    .toBeLessThan(5);
  await writing.press("Control+A");
  await writing.press("Backspace");
  await expect(writing).toHaveText("");
  await page
    .locator(".paginated-editor .editor-scroll")
    .evaluate((el) => el.scrollTo(0, 0));
  for (const name of ["Write", "Pages"]) {
    const tab = page.getByRole("tab", { name, exact: true });
    await expect(tab).toHaveText("");
    await expect(tab).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-arranger > p")).toHaveCount(0);
  await page.evaluate(() => {
    window.centerSamples = [];
    const editor = document.querySelector(".book-editor");
    window.centerObserver = new MutationObserver(() => {
      if (editor.classList.contains("measuring-editor")) return;
      const box = editor
        .querySelector(".editor-scroll")
        .getBoundingClientRect();
      const sheet = editor.querySelector(".page-sheet").getBoundingClientRect();
      window.centerSamples.push(
        Math.abs(sheet.left - box.left - (box.right - sheet.right)),
      );
    });
    window.centerObserver.observe(editor, { attributes: true, subtree: true });
  });
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  const returnedCenter = await page.evaluate(() => {
    window.centerObserver.disconnect();
    return window.centerSamples;
  });
  expect(returnedCenter.length).toBeGreaterThan(0);
  expect(Math.max(...returnedCenter)).toBeLessThan(5);
  expect(
    (await page.getByRole("spinbutton", { name: "Go To Page" }).boundingBox())
      .width,
  ).toBeLessThan(30);
  await expect(page.locator(".alder-app [title]")).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle help area" }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).hover();
  const help = page.getByLabel("Context help", { exact: true });
  await expect(help).toContainText("Preview the saved publication layout");
  const helpBox = await help.boundingBox(),
    root = await page.locator(".alder-app").boundingBox();
  expect(helpBox.x + helpBox.width).toBeGreaterThan(root.x + root.width - 20);
  expect(helpBox.width).toBeLessThan(root.width / 2);
  await expect(page.locator(".menubar")).toHaveCount(0);
  const nativeMenus = await app.evaluate(({ Menu, BrowserWindow }) => ({
    visible: BrowserWindow.getAllWindows()[0].isMenuBarVisible(),
    labels: Menu.getApplicationMenu().items.map((item) => item.label),
  }));
  expect(nativeMenus.visible).toBe(true);
  expect(nativeMenus.labels).toEqual([
    "File",
    "Edit",
    "Create",
    "Read",
    "View",
    "Options",
    "Help",
  ]);
  await left.click();
  const browser = page.getByRole("complementary", { name: "Language browser" });
  const old = await browser.boundingBox();
  const handle = page.getByRole("separator", { name: "Resize Left Panel" });
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 30, { steps: 8 });
  await page.mouse.up();
  expect((await browser.boundingBox()).width).toBeGreaterThan(old.width + 70);
  await expect(page.locator(".window-brand, .writing-commandbar")).toHaveCount(
    0,
  );
  await expect(page.locator(".window-document")).toHaveCount(0);
  await expect(page.locator(".reader-progress")).toHaveCount(0);
  await expect(
    browser
      .locator(".browser-search")
      .getByRole("button", { name: "Toggle Left Panel" }),
  ).toBeVisible();
  expect(
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()
        .items.find((item) => item.label === "Create")
        .submenu.items.some((item) => item.label === "Chapter"),
    ),
  ).toBe(false);
  await writing.fill("Three simple words");
  await expect(page.locator(".page-navigation")).toContainText("3 Words");
  await expect(page.locator(".page-navigation")).not.toContainText("Chapters");
  await writing.press("Control+A");
  await writing.press("Backspace");
  await expect(writing).toHaveText("");
  const nav = browser.getByRole("navigation", {
    name: "Collections And Library",
  });
  await expect(
    nav.getByRole("button", { name: "Ideas", exact: true }),
  ).toHaveCount(0);
  await expect(
    nav.getByRole("button", { name: "Words", exact: true }),
  ).toBeVisible();
  await expect(browser.locator(".browser-preview")).toHaveCount(0);
  await expect(browser.locator(".browser-bottom-space")).toHaveCount(0);
  expect(
    Math.abs(
      (await browser.locator(".browser-main").boundingBox()).y +
        (await browser.locator(".browser-main").boundingBox()).height -
        ((await browser.boundingBox()).y +
          (await browser.boundingBox()).height),
    ),
  ).toBeLessThan(3);
  await expect(page.locator(".book-page-tools")).toHaveCount(0);
  await expect(
    page.locator(".page-navigation").getByLabel("Page zoom"),
  ).toBeVisible();

  await nav.getByRole("button", { name: "Drafts", exact: true }).click();
  const draftFilters = browser.getByRole("region", { name: "Library Filters" });
  await expect(draftFilters.locator(".filter-chips button")).toHaveText([
    "All",
    "Past Day",
    "Past Week",
    "Past Month",
    "Past Year",
  ]);
  await draftFilters
    .getByRole("button", { name: "Past Day", exact: true })
    .click();
  await expect(browser.locator(".library-list .library-item")).toHaveCount(1);
  await expect(draftFilters).toHaveCSS(
    "background-color",
    await draftFilters
      .locator(".filter-area")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  );
  await nav.getByRole("button", { name: "Words", exact: true }).click();
  expect(
    (await nav.locator("button").allTextContents())
      .map((s) => s.trim())
      .slice(1, 7),
  ).toEqual([
    "Words",
    "Language Tools",
    "Styles",
    "Templates",
    "Voices",
    "Drafts",
  ]);
  await expect(browser).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const navBefore = await nav.boundingBox();
  const divider = await browser
    .getByRole("separator", { name: "Resize Collections And Content" })
    .boundingBox();
  await page.mouse.move(divider.x + divider.width / 2, divider.y + 35);
  await page.mouse.down();
  await page.mouse.move(divider.x + 64, divider.y + 35, { steps: 8 });
  await page.mouse.up();
  expect((await nav.boundingBox()).width).toBeGreaterThan(navBefore.width + 40);
  const filters = browser.getByRole("region", { name: "Library Filters" });
  const filterBefore = await filters.boundingBox();
  const filterDivider = await browser
    .getByRole("separator", { name: "Resize Filters And Content" })
    .boundingBox();
  await page.mouse.move(filterDivider.x + 30, filterDivider.y + 3);
  await page.mouse.down();
  await page.mouse.move(filterDivider.x + 30, filterDivider.y + 53, {
    steps: 8,
  });
  await page.mouse.up();
  expect((await filters.boundingBox()).height).toBeGreaterThan(
    filterBefore.height + 30,
  );
  // Make room for the inline managers after verifying both dividers.
  const collectionsDivider = browser.getByRole("separator", {
    name: "Resize Collections And Content",
  });
  await collectionsDivider.focus();
  for (let i = 0; i < 7; i++) await collectionsDivider.press("ArrowLeft");
  for (const name of ["Styles", "Templates", "Projects", "Project Assets"]) {
    await browser.getByRole("button", { name, exact: true }).click();
    await expect(
      browser.getByRole("region", { name, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(filters).toHaveCount(0);
  }
  await browser.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(browser.locator(".project-list-item")).not.toHaveCount(0);
  await browser.getByRole("button", { name: "Voices", exact: true }).click();
  await expect(
    browser.getByRole("region", { name: "Voice Management" }),
  ).toBeVisible();
  await expect(
    browser.getByRole("button", {
      name: "Add reference voice",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    browser.getByRole("heading", { name: "Voices", exact: true }),
  ).toHaveCount(1);
  await expect(
    browser.getByRole("heading", { name: "Dictionaries", exact: true }),
  ).toHaveCount(1);
  await expect(
    browser.getByRole("button", {
      name: "Add or create dictionary",
      exact: true,
    }),
  ).toBeVisible();
  await browser
    .locator(".voice-dictionary-panel")
    .screenshot({ path: path.resolve("work/voice-panel.png") });
  const voiceLibrary = browser.getByRole("region", { name: "Voice Library" });
  const voiceRows = await page.evaluate(
    async () =>
      (await window.alder.request("GET", "/api/speech/voices")).voices,
  );
  const systemVoice = voiceRows.find((v) => v.kind === "sapi");
  expect(systemVoice).toBeTruthy();
  await voiceLibrary
    .getByRole("button", {
      name: `Select voice ${systemVoice.name}`,
      exact: true,
    })
    .dblclick();
  await expect(
    voiceLibrary.getByLabel("Voice name", { exact: true }),
  ).toHaveValue(systemVoice.name);
  await voiceLibrary
    .getByLabel("Voice name", { exact: true })
    .fill("Library Reading Voice");
  await expect(
    voiceLibrary.getByLabel("Voice name", { exact: true }),
  ).toHaveValue("Library Reading Voice");
  await voiceLibrary.getByLabel("Voice name", { exact: true }).press("Enter");
  await expect(
    voiceLibrary.getByRole("button", {
      name: "Rename voice Library Reading Voice",
      exact: true,
    }),
  ).toBeEnabled();
  await voiceLibrary
    .getByRole("button", {
      name: "Rename voice Library Reading Voice",
      exact: true,
    })
    .click();
  await voiceLibrary
    .getByLabel("Voice name", { exact: true })
    .fill("Cancelled name");
  await voiceLibrary.getByLabel("Voice name", { exact: true }).press("Escape");
  await expect(
    voiceLibrary.getByRole("button", {
      name: "Select voice Library Reading Voice",
      exact: true,
    }),
  ).toBeVisible();
  const readingVoiceOption = page
    .getByLabel("Reading voice", { exact: true })
    .locator(`option[value="${systemVoice.id}"]`);
  await expect(readingVoiceOption).toHaveText("Library Reading Voice");
  await expect(
    voiceLibrary.getByRole("button", { name: "Audition", exact: true }),
  ).toHaveCount(0);
  await voiceLibrary
    .getByRole("button", {
      name: "Test voice Library Reading Voice",
      exact: true,
    })
    .click();
  await expect
    .poll(() => voiceLibrary.locator("audio").evaluate((a) => a.currentTime), {
      timeout: 20000,
    })
    .toBeGreaterThan(0.05);
  await expect(writing).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator(".persistent-caret .write-caret")).toHaveCSS(
    "visibility",
    "hidden",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await voiceLibrary
    .getByRole("button", {
      name: "Stop testing Library Reading Voice",
      exact: true,
    })
    .click();
  await expect(page.locator(".persistent-caret .write-caret")).toHaveCSS(
    "visibility",
    "visible",
  );
  await voiceLibrary
    .getByRole("button", {
      name: "Remove voice Library Reading Voice",
      exact: true,
    })
    .click();
  await expect(readingVoiceOption).toHaveCount(0);
  await expect(
    voiceLibrary.getByRole("checkbox", {
      name: "Show Removed Voices",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    voiceLibrary.getByRole("button", {
      name: "Select voice Library Reading Voice",
      exact: true,
    }),
  ).toHaveCount(0);
  await browser.getByRole("button", { name: "Add or create dictionary", exact: true }).click();
  await page.getByRole("menuitem", { name: "Create", exact: true }).click();
  await browser.getByRole("textbox", { name: "Dictionary name", exact: true }).press("Enter");
  await browser.getByRole("button", { name: "Edit dictionary New Dictionary", exact: true }).click();
  const pronunciationDialog = page.getByRole("dialog", {
    name: /Pronunciation/,
  });
  await pronunciationDialog
    .getByRole("button", { name: "New Rule", exact: true })
    .click();
  await pronunciationDialog
    .getByLabel("Written Text", { exact: true })
    .fill("Alder");
  await pronunciationDialog
    .getByLabel("Speak As", { exact: true })
    .fill("All der");
  await pronunciationDialog
    .getByRole("button", { name: "Save Rule", exact: true })
    .click();
  await expect(
    pronunciationDialog.getByRole("listbox", { name: "Pronunciation Rules" }),
  ).toContainText("All der");
  await pronunciationDialog
    .getByRole("button", { name: "Close Dictionary Editor", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(browser.getByText("Manage voices", { exact: true })).toHaveCount(
    0,
  );
  const sandboxToggle = page.getByRole("button", {
    name: "Toggle sandbox",
    exact: true,
  });
  if ((await sandboxToggle.getAttribute("aria-expanded")) === "false")
    await sandboxToggle.click();
  await page
    .locator(".detail-heading")
    .getByRole("tab", { name: "Sandbox", exact: true })
    .click();
  const sandbox = page.getByRole("textbox", {
    name: "Sandbox text editor",
    exact: true,
  });
  await expect(sandbox).toBeVisible();
  await expect(page.locator(".clip-properties output").first()).toHaveCSS(
    "border-top-width",
    "0px",
  );
  const wordPanel = page.locator(".word-workbench");
  const wordBefore = await wordPanel.boundingBox();
  const wordHandle = page.getByRole("separator", {
    name: "Resize Sandbox Word Panel",
  });
  await expect(wordHandle).toHaveCSS("width", "1px");
  const wh = await wordHandle.boundingBox();
  await page.mouse.move(wh.x, wh.y + 20);
  await page.mouse.down();
  await page.mouse.move(wh.x - 60, wh.y + 20, { steps: 8 });
  await page.mouse.up();
  expect((await wordPanel.boundingBox()).width).toBeGreaterThan(
    wordBefore.width + 40,
  );
  const projectName = await page.locator(".project-label").boundingBox();
  const actions = await page.locator(".project-actions").boundingBox();
  expect(actions.x - (projectName.x + projectName.width)).toBeLessThan(20);
  await expect(page.locator(".workspace-topline")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(page.getByLabel("Reading voice", { exact: true })).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  for (const word of ["I", "want", "to", "write"]) {
    const transfer = await page.evaluateHandle((word) => {
      const dt = new DataTransfer();
      dt.setData("application/x-alder-idea", JSON.stringify({ word }));
      return dt;
    }, word);
    const at = await sandbox.locator("p").last().boundingBox();
    await sandbox.dispatchEvent("drop", {
      dataTransfer: transfer,
      clientX: at.x + at.width - 15,
      clientY: at.y + at.height / 2,
    });
    await transfer.dispose();
  }
  await expect(sandbox).toHaveText("I want to write");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const saved = await page.evaluate(() =>
    window.alder.request(
      "GET",
      `/api/projects/${localStorage.getItem("alder.project")}`,
    ),
  );
  expect(saved.clips[0].text.trim()).toBe("I want to write");
  expect(saved.book.chapters[0].text).toBe("");
  const accent = await page
    .getByLabel("Reading speed slider", { exact: true })
    .evaluate((el) => getComputedStyle(el).accentColor);
  expect(accent).toBe("rgb(41, 63, 94)");
  expect(errors).toEqual([]);
  fs.writeFileSync(
    "work/workspace-desktop-result.json",
    JSON.stringify({ ok: true, centre, helpBox, accent, errors }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, centre, helpBox, accent, errors }));
  const screenshot = await app.evaluate(async ({ BrowserWindow }) => {
    const picture =
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true, stayAwake: true },
      );
    return picture.toPNG().toString("base64");
  });
  fs.writeFileSync(
    "work/workspace-desktop.png",
    Buffer.from(screenshot, "base64"),
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
