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
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1400, 1000);
    window.showInactive();
  });
  const toggle = page.getByRole("button", {
    name: "Toggle Left Panel",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  const browser = page.getByRole("complementary", { name: "Language browser" });
  const divider = await page
    .getByRole("separator", { name: "Resize Left Panel" })
    .boundingBox();
  await page.mouse.move(divider.x + divider.width / 2, divider.y + 30);
  await page.mouse.down();
  await page.mouse.move(530, divider.y + 30, { steps: 8 });
  await page.mouse.up();
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
  await expect(
    voiceLibrary.getByLabel("Voice name", { exact: true }),
  ).toHaveCSS("border-top-width", "0px");
  await expect(
    voiceLibrary.getByLabel("Voice name", { exact: true }),
  ).toHaveCSS("outline-style", "none");
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
  const addVoice = page.waitForEvent("filechooser");
  await browser
    .getByRole("button", { name: "Add reference voice", exact: true })
    .click();
  expect(await (await addVoice).element().getAttribute("accept")).toBe(
    "audio/*",
  );
  const library = browser.getByRole("region", {
    name: "Pronunciation Dictionaries",
    exact: true,
  });
  for (const [name, content] of [
    ["Reading", "Alder=All der\nCodex=Code ex"],
    ["Names", "Edward=Ed ward"],
  ]) {
    const chooser = page.waitForEvent("filechooser");
    await library
      .getByRole("button", {
        name: "Add or create dictionary",
        exact: true,
      })
      .click();
    await page.getByRole("menuitem", { name: "Add", exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: `${name}.rex`,
      mimeType: "text/plain",
      buffer: Buffer.from(content),
    });
    await expect(
      library.getByRole("button", {
        name: `Select dictionary ${name}.rex`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await expect(library.locator(".voice-card")).toHaveCount(2);
  const readingActive = library.getByRole("checkbox", { name: "Active dictionary Reading.rex", exact: true });
  const namesActive = library.getByRole("checkbox", { name: "Active dictionary Names.rex", exact: true });
  await expect(readingActive).toBeChecked();
  await expect(namesActive).toBeChecked();
  await readingActive.uncheck();
  await expect(namesActive).toBeChecked();
  await namesActive.uncheck();
  await expect(readingActive).not.toBeChecked();
  await namesActive.check();
  await library
    .getByRole("button", { name: "Select dictionary Reading.rex", exact: true })
    .dblclick();
  const dictionaryInput = library.getByRole("textbox", {
    name: "Dictionary name",
    exact: true,
  });
  await expect(dictionaryInput).toHaveCSS("border-top-width", "0px");
  await expect(dictionaryInput).toHaveCSS("outline-style", "none");
  await dictionaryInput.fill("Reading Rules");
  await dictionaryInput.press("Enter");
  const renamed = library.locator(".voice-card").filter({
    has: page.getByRole("button", {
      name: "Select dictionary Reading Rules",
      exact: true,
    }),
  });
  await expect(renamed).toContainText("2 Rules");
  await expect(library.getByRole("checkbox", { name: "Active dictionary Reading Rules", exact: true })).not.toBeChecked();
  await expect(namesActive).toBeChecked();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const activeProject = await page.evaluate(async () => window.alder.request("GET", `/api/projects/${localStorage.getItem("alder.project")}`));
  expect(activeProject.settings.disabledPronunciationDictionaries).toEqual(["Reading Rules"]);

  await renamed
    .getByRole("button", {
      name: "Rename dictionary Reading Rules",
      exact: true,
    })
    .click();
  await dictionaryInput.fill("Cancelled");
  await dictionaryInput.press("Escape");
  await expect(renamed).toBeVisible();
  await renamed
    .getByRole("button", {
      name: "Rename dictionary Reading Rules",
      exact: true,
    })
    .click();
  await dictionaryInput.fill("Names.rex");
  await dictionaryInput.press("Enter");
  await expect(library.getByRole("alert")).toHaveText(
    "A dictionary with that name already exists.",
  );
  await dictionaryInput.press("Escape");
  await renamed
    .getByRole("button", { name: "Edit dictionary Reading Rules", exact: true })
    .click();
  await expect(
    page.getByLabel("Pronunciation Dictionary Filter", { exact: true }),
  ).toHaveValue("Reading Rules");
  await expect(
    page
      .getByRole("listbox", { name: "Pronunciation Rules" })
      .getByRole("option"),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Close Dictionary Editor", exact: true })
    .click();
  await library.screenshot({ path: path.resolve("work/dictionary-cards.png") });
  await renamed
    .getByRole("button", {
      name: "Remove dictionary Reading Rules",
      exact: true,
    })
    .click();
  await expect(library.locator(".voice-card")).toHaveCount(1);
  await expect(library.locator(".voice-card")).toContainText("Names");
  await expect(library.locator(".voice-card")).toContainText("1 Rules");
  await library
    .getByRole("button", { name: "Remove dictionary Names.rex", exact: true })
    .click();
  await library
    .getByRole("button", { name: "Add or create dictionary" })
    .click();
  await page.getByRole("menuitem", { name: "Create", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(dictionaryInput).toHaveValue("New Dictionary");
  await dictionaryInput.fill("Empty Dictionary");
  await dictionaryInput.press("Enter");
  await expect(library.locator(".voice-card")).toContainText("0 Rules");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const savedProject = await page.evaluate(async () => window.alder.request("GET", `/api/projects/${localStorage.getItem("alder.project")}`));
  expect(savedProject.settings.pronunciationDictionaries).toContain("Empty Dictionary");
  expect(savedProject.pronunciation).toHaveLength(0);
  await library
    .getByRole("button", { name: "Add or create dictionary" })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Add dictionary" })).toHaveCount(
    0,
  );
  await library
    .getByRole("button", { name: "Add or create dictionary" })
    .click();
  await page.getByRole("menuitem", { name: "Create", exact: true }).click();
  await dictionaryInput.press("Enter");
  const firstDictionary = library.locator(".voice-card").first();
  await firstDictionary.click({ position: { x: 3, y: 3 } });
  await expect(firstDictionary).toHaveClass(/selected/);
  await expect(firstDictionary).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  const voiceCard = voiceLibrary.locator(".voice-card").first();
  await voiceCard.click({ position: { x: 3, y: 3 } });
  await expect(voiceCard).toHaveClass(/selected/);
  await expect(voiceCard).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await library.screenshot({ path: path.resolve("work/dictionary-cards.png") });
  await library
    .getByRole("button", {
      name: "Edit dictionary Empty Dictionary",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Written Text", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByRole("button", { name: "Close Dictionary Editor", exact: true })
    .click();
  const groups = voiceLibrary.locator(".voice-group");
  await expect(groups).toHaveCount(2);
  const gap = await groups.evaluateAll(
    (groups) =>
      groups[1].getBoundingClientRect().top -
      groups[0].getBoundingClientRect().bottom,
  );
  expect(gap).toBeGreaterThan(15);
  const cardSizes = await voiceLibrary
    .locator(".voice-card")
    .evaluateAll((cards) =>
      cards.map((card) => ({
        height: card.getBoundingClientRect().height,
        overflow: card.scrollWidth - card.clientWidth,
      })),
    );
  expect(
    cardSizes.every((card) => card.height >= 60 && card.overflow <= 1),
  ).toBe(true);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ ok: true, cardSizes, gap }));
} finally {
  await app.close();
}
