import { _electron as electron, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
const dictionary = process.argv[2];
const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/Alder.exe"),
  args: [
    ".",
    "--headless-test",
    "--mute-audio",
    `--user-data-dir=${path.resolve(`work/rex-ui-${Date.now()}`)}`,
  ],
  env: {
    ...process.env,
    ALDER_DATA_DIR: path.resolve(`work/rex-desktop-${Date.now()}`),
  },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  if (
    !(await page
      .getByRole("button", { name: "Voices", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: "Toggle Left Panel", exact: true })
      .click();
  await page.getByRole("button", { name: "Voices", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Voice Library", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Selected Pronunciation Dictionary", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pronunciation", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Written Text", { exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Edit Dictionary…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: /Pronunciation/ });
  await expect(dialog).toBeVisible();
  const manager = page.getByRole("region", {
    name: "Pronunciation Dictionary",
  });
  await expect(manager).toBeVisible();
  await manager.getByLabel("Import Pronunciation Dictionary").setInputFiles(
    dictionary || {
      name: "example.rex",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "\\b(aged)\\b=age-id\n@(Alam)\\b=Ah-lum\n@Kunti=Koonti",
      ),
    },
  );
  await expect(
    manager.getByRole("status", { name: "Dictionary Status" }),
  ).toHaveText(`${dictionary ? 264 : 3} Rules Imported`);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await manager.getByLabel("Find Pronunciation").fill("aged");
  await manager.getByRole("option").filter({ hasText: "aged" }).click();
  await expect(manager.getByLabel("Written Text", { exact: true })).toHaveValue(
    "aged",
  );
  await expect(
    manager.getByLabel("Pronunciation Match", { exact: true }),
  ).toHaveValue("whole");
  await manager
    .getByLabel("Pronunciation Test Text")
    .fill("aged unaged agedly AGED");
  await manager.getByRole("button", { name: "Show Spoken Text" }).click();
  await expect(manager.getByLabel("Spoken Text", { exact: true })).toHaveText(
    "age-id unaged agedly age-id",
  );
  await manager.getByLabel("Match Capitalisation", { exact: true }).check();
  await manager.getByRole("button", { name: "Save Rule" }).click();
  await manager.getByRole("button", { name: "Show Spoken Text" }).click();
  await expect(manager.getByLabel("Spoken Text", { exact: true })).toHaveText(
    "age-id unaged agedly AGED",
  );
  await manager
    .getByLabel("Pronunciation Match", { exact: true })
    .selectOption("anywhere");
  await manager.getByRole("button", { name: "Show Spoken Text" }).click();
  await expect(manager.getByLabel("Spoken Text", { exact: true })).toHaveText(
    "age-id unage-id age-idly AGED",
  );
  await manager.getByRole("button", { name: "New Rule", exact: true }).click();
  await manager.getByLabel("Written Text", { exact: true }).fill("rat");
  await manager.getByLabel("Speak As", { exact: true }).fill("mouse");
  await manager.getByRole("button", { name: "Save Rule" }).click();
  await expect(
    manager.getByRole("status", { name: "Dictionary Status" }),
  ).toHaveText("Rule Saved");
  await manager.getByRole("button", { name: "New Rule", exact: true }).click();
  await manager.getByLabel("Written Text", { exact: true }).fill("mouse");
  await manager.getByLabel("Speak As", { exact: true }).fill("hamster");
  await manager.getByRole("button", { name: "Save Rule" }).click();
  await manager.getByLabel("Test Rules", { exact: true }).selectOption("all");
  await manager.getByLabel("Pronunciation Test Text").fill("rat mouse");
  await manager.getByRole("button", { name: "Show Spoken Text" }).click();
  await expect(manager.getByLabel("Spoken Text", { exact: true })).toHaveText(
    "hamster hamster",
  );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const result = await page.evaluate(async () => {
    const id = localStorage.getItem("alder.project");
    const project = await window.alder.request("GET", `/api/projects/${id}`);
    const response = await fetch(
      `${window.alder.mediaBase}/api/projects/${id}/pronunciation/rex`,
    );
    return {
      rules: project.pronunciation,
      text: await response.text(),
      status: response.status,
    };
  });
  expect(result.status).toBe(200);
  expect(result.rules.length).toBe((dictionary ? 264 : 3) + 2);
  expect(result.text).toContain("@\\baged\\b=age-id");
  expect(result.text).toContain("\\brat\\b=mouse");
  // Imported captures and conditions remain editable without an expression field.
  await manager.getByLabel("Import Pronunciation Dictionary").setInputFiles({
    name: "patterns.rex",
    mimeType: "text/plain",
    buffer: Buffer.from("@\\b([A-Z]+)-(\\d+)\\b=\\L$1\\E number $2"),
  });
  await expect(
    manager.getByRole("status", { name: "Dictionary Status" }),
  ).toHaveText("1 Rule Imported");
  await expect(
    manager.getByLabel("Pronunciation Match", { exact: true }),
  ).toHaveValue("pattern");
  await expect(
    manager
      .getByRole("button", { name: "Add Matching Part", exact: true })
      .first(),
  ).toBeVisible();
  await manager.getByLabel("Test Rules", { exact: true }).selectOption("rule");
  await manager.getByLabel("Pronunciation Test Text").fill("ABC-12");
  await manager.getByRole("button", { name: "Show Spoken Text" }).click();
  await expect(manager.getByLabel("Spoken Text", { exact: true })).toHaveText(
    "abc number 12",
  );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const layout = await dialog.evaluate((el) => {
    const list = el
      .querySelector(".pronunciation-list-panel")
      .getBoundingClientRect();
    const detail = el
      .querySelector(".pronunciation-detail-panel")
      .getBoundingClientRect();
    return {
      width: el.getBoundingClientRect().width,
      listRight: list.right,
      detailLeft: detail.left,
    };
  });
  expect(layout.width).toBeGreaterThan(800);
  expect(layout.detailLeft).toBeGreaterThanOrEqual(layout.listRight);
  await manager
    .getByLabel("Spoken Part 2 Text", { exact: true })
    .fill(" pending number ");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("region", { name: "Voice Library", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Dictionary…", exact: true })
    .click();
  await expect(manager.getByLabel("Pronunciation Test Text")).toHaveValue(
    "ABC-12",
  );
  await expect(
    manager.getByLabel("Spoken Part 2 Text", { exact: true }),
  ).toHaveValue(" pending number ");
  // Capture the normal dictionary editor at the top, with the list alongside it.
  await manager
    .getByLabel("Pronunciation Dictionary Filter")
    .selectOption(dictionary ? "en_GB.rex" : "example.rex");
  await manager.getByLabel("Find Pronunciation").fill("aged");
  await manager.getByRole("option").filter({ hasText: "aged" }).click();
  await expect(manager.getByLabel("Written Text", { exact: true })).toHaveValue(
    "aged",
  );
  await manager.getByLabel("Find Pronunciation").fill("");
  await dialog
    .locator(".pronunciation-detail-panel")
    .evaluate((el) => (el.scrollTop = 0));
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
  fs.writeFileSync(
    "work/pronunciation-editor.png",
    Buffer.from(capture, "base64"),
  );
  await page
    .getByRole("button", { name: "Close Dictionary Editor", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      ok: true,
      imported: dictionary ? 264 : 3,
      caseAndBoundaries: true,
      cascading: true,
      patternBuilder: true,
      rexExport: true,
    }),
  );
} finally {
  const timer = setTimeout(() => app.process().kill(), 10000);
  try {
    await app.close();
  } finally {
    clearTimeout(timer);
  }
}
