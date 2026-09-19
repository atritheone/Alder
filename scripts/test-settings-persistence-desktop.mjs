import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const data = fs.mkdtempSync(
  path.join(os.tmpdir(), "alder-settings-persistence-"),
);
let app;
const errors = [];
async function launch() {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1280, 900);
    w.showInactive();
  });
  await page.getByRole("button", { name: "New", exact: true }).waitFor();
  return page;
}
async function settings(page) {
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()
      .items.find((i) => i.label === "Edit")
      .submenu.items.find((i) => i.label === "Settings…");
    item.click(item, BrowserWindow.getAllWindows()[0]);
  });
  return page.getByRole("dialog", { name: "Settings", exact: true });
}
async function reopen(page) {
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator(".project-list-item").first().click();
  await page
    .getByRole("textbox", { name: "Chapter text editor", exact: true })
    .waitFor();
}
// Set every value away from its default, then verify through the UI after a full restart.
const values = {
  Appearance: { "UI Scale": "0.9" },
  Writing: {
    "Check writing": false,
    "Check sandbox": false,
    "Body font": "Arial",
    "Body size (pt)": "15",
    "Line height": "1.9",
  },
  "Page Layout": {
    "Page size": "A5",
    Orientation: "landscape",
    "Margins (mm)": "23",
    "Running header": "Persistent header",
    "Page numbers in footer": false,
    "Start page numbering at": "12",
  },
  Publication: {
    Author: "Persistent author",
    Description: "Persistent description",
    Publisher: "Persistent publisher",
    Subject: "Persistent subject",
    "Rights statement": "Persistent rights",
    "ISBN or identifier": "urn:alder:test",
    "Include title": false,
    "Table of contents": true,
    "Include glossary": true,
  },
  Speech: {
    "Write speed": "1.31",
    "Write volume": "1.5",
    "Sandbox speed": "1.42",
    "Sandbox volume": "0.8",
    "Narration speed": "0.93",
    "Narration volume": "2.5",
    "Narration format": "flac",
    "Narration boundary pause": "0.4",
    "Strict wording verification": true,
    "Content-check retries": "2",
    "Speech temperature": "0.65",
    "Speech top P": "0.85",
    "Speech top K": "500",
    "Speech repetition penalty": "1.4",
  },
};
async function visit(dialog, category) {
  await dialog.getByRole("tab", { name: category, exact: true }).click();
  if (category === "Speech")
    await dialog.getByText("Turbo sampling", { exact: true }).click();
}
try {
  let page = await launch();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  // A real image asset exercises persistence of the cover selection as well.
  const cover = await page.evaluate(async () =>
    window.alder.upload(
      `/api/projects/${localStorage.getItem("alder.project")}/assets`,
      "cover.png",
      Array.from(
        Uint8Array.from(
          atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
          ),
          (c) => c.charCodeAt(0),
        ),
      ),
    ),
  );
  await page.evaluate(async (id) => {
    const url = `/api/projects/${localStorage.getItem("alder.project")}`;
    const project = await window.alder.request("GET", url);
    // Seed a typed image fixture; the byte-only upload bridge sends an untyped Blob.
    project.assets.find((asset) => asset.id === id).mime = "image/png";
    await window.alder.request("PUT", url, {
      project,
      expectedRevision: project.revision,
    });
  }, cover.id);
  values.Publication["Ebook cover"] = cover.id;
  await page.reload();
  await reopen(page);
  let dialog = await settings(page);
  await visit(dialog, "Writing");
  values.Writing["Body font"] = await dialog
    .getByLabel("Body font", { exact: true })
    .evaluate(
      (select) =>
        Array.from(select.options).find(
          (option) => option.value !== select.value,
        )?.value || select.value,
    );
  for (const [category, fields] of Object.entries(values)) {
    await visit(dialog, category);
    for (const [label, value] of Object.entries(fields)) {
      const control = dialog.getByLabel(label, { exact: true });
      if (typeof value === "boolean") await control.setChecked(value);
      else if (await control.evaluate((el) => el.tagName === "SELECT"))
        await control.selectOption(value);
      else await control.fill(value);
    }
  }
  await visit(dialog, "Language Rules");
  await dialog.getByRole("button", { name: "New rule", exact: true }).click();
  for (const [label, value] of Object.entries({
    "Rule name": "Persistent rule",
    "Wording to find": "colour",
    "Suggested replacement": "color",
    Explanation: "Consistent spelling",
  })) {
    await dialog.getByLabel(label, { exact: true }).fill(value);
  }
  await dialog.getByLabel("Match case", { exact: true }).check();
  await dialog.getByLabel("Whole words", { exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Save rule", exact: true }).click();
  await dialog.getByLabel("Enable Persistent rule", { exact: true }).uncheck();
  // Close via the real application lifecycle without Done or an explicit save.
  const closed = app.waitForEvent("close");
  await app.evaluate(({ app }) => {
    setTimeout(() => app.quit(), 0);
  });
  await closed;
  app = null;
  page = await launch();
  // Application values are available even before a document is reopened.
  dialog = await settings(page);
  await expect(dialog.getByLabel("UI Scale", { exact: true })).toHaveValue(
    "0.9",
  );
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await reopen(page);
  dialog = await settings(page);
  for (const [category, fields] of Object.entries(values)) {
    await visit(dialog, category);
    for (const [label, value] of Object.entries(fields)) {
      const control = dialog.getByLabel(label, { exact: true });
      if (typeof value === "boolean")
        await expect(control).toBeChecked({ checked: value });
      else await expect(control).toHaveValue(value);
    }
  }
  await visit(dialog, "Language Rules");
  await expect(
    dialog.getByLabel("Enable Persistent rule", { exact: true }),
  ).not.toBeChecked();
  await dialog.getByRole("button", { name: "Edit rule", exact: true }).click();
  await expect(
    dialog.getByLabel("Wording to find", { exact: true }),
  ).toHaveValue("colour");
  await expect(
    dialog.getByLabel("Suggested replacement", { exact: true }),
  ).toHaveValue("color");
  await expect(dialog.getByLabel("Explanation", { exact: true })).toHaveValue(
    "Consistent spelling",
  );
  await expect(dialog.getByLabel("Match case", { exact: true })).toBeChecked();
  await expect(
    dialog.getByLabel("Whole words", { exact: true }),
  ).not.toBeChecked();
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      ok: true,
      persistedControls: Object.values(values).reduce(
        (total, fields) => total + Object.keys(fields).length,
        0,
      ),
      customRule: true,
      closeWithSettingsOpen: true,
    }),
  );
} finally {
  if (app) await app.close();
}
