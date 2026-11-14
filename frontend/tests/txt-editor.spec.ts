import { test, expect } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { openSaved } from "./openSaved";

test.use({
  baseURL: process.env.ALDER_TXT_TEST_URL || "http://127.0.0.1:4173",
  viewport: { width: 1600, height: 1000 },
  launchOptions: { channel: "msedge" },
});
test.setTimeout(60000);
test("searches and replaces across open TXT tabs with independent undo", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  const firstName = `TXT first ${Date.now()}`,
    secondName = `TXT second ${Date.now()}`;
  await page.getByLabel("Name", { exact: true }).fill(firstName);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "TXT text editor",
    exact: true,
  });
  await editor.fill("needle first");
  const firstId = await page.evaluate(() =>
    localStorage.getItem("alder.project"),
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "New project…", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill(secondName);
  await page
    .getByRole("dialog", { name: "New document", exact: true })
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: secondName, exact: true }),
  ).toBeVisible();
  await editor.fill("needle second");
  const secondId = await page.evaluate(() =>
    localStorage.getItem("alder.project"),
  );
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Search open TXT documents…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Search open TXT documents",
    exact: true,
  });
  await dialog.getByLabel("Find text", { exact: true }).fill("needle");
  await expect(dialog.getByRole("status")).toContainText("2 matches");
  await dialog
    .getByRole("textbox", { name: "Replacement text", exact: true })
    .fill("target");
  await dialog
    .getByRole("button", { name: "Replace all", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("No matches");
  for (const [id, expected] of [
    [firstId, "target first"],
    [secondId, "target second"],
  ])
    await expect
      .poll(async () => {
        const p = await (await page.request.get(`/api/projects/${id}`)).json();
        return p.book.chapters[0].text;
      })
      .toBe(expected);
  await dialog
    .getByRole("button", { name: "Close find and replace", exact: true })
    .click();
  await editor.press("Control+z");
  await expect(editor).toHaveText("needle second");
  await page.getByRole("tab", { name: firstName, exact: true }).click();
  await expect(editor).toHaveText("target first");
  await editor.press("Control+z");
  await expect(editor).toHaveText("needle first");
});
test("TXT Write uses the plain editor, completes file words, highlights matches and preserves saved bytes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill(`TXT editor qualification ${Date.now()}`);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "TXT text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await editor.fill("aurora one\naurora two\nau");
  await editor.press("Control+End");
  await editor.pressSequentially("r");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText(
    "aurora",
  );
  await editor.press("Enter");
  await expect(editor).toHaveText("aurora oneaurora twoaurora");
  await editor.press("Control+Home");
  for (let i = 0; i < 6; i++) await editor.press("Shift+ArrowRight");
  await expect(page.locator(".cm-selectionMatch")).toHaveCount(3);
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.getByRole("button", { name: "Text tools", exact: true }).click();
  await page
    .getByRole("button", { name: "Toggle bookmark", exact: true })
    .click();
  await expect(
    page.getByText("Bookmarked lines (1)", { exact: true }),
  ).toBeVisible();
  await editor.fill("abc");
  await editor.press("Control+End");
  await page.getByText("Macros & snippets", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Macro name", exact: true })
    .fill("Append Z");
  await page.getByRole("button", { name: "Record macro", exact: true }).click();
  await editor.pressSequentially("Z");
  await page
    .getByRole("button", { name: "Stop and save recording", exact: true })
    .click();
  await page.getByRole("button", { name: "Play macro", exact: true }).click();
  await expect(editor).toHaveText("abcZZ");
  await editor.press("Control+z");
  await expect(editor).toHaveText("abcZ");
  await editor.fill("aurora one\naurora two\naurora");
  await expect(page.locator(".save-status")).toHaveText("Saved", {
    timeout: 15000,
  });
  const id = await page.evaluate(() => localStorage.getItem("alder.project"));
  const result = await (
    await page.request.post(`/api/projects/${id}/export`, {
      data: { format: "txt" },
    })
  ).json();
  expect(await (await page.request.get(result.downloadUrl)).text()).toBe(
    "aurora one\naurora two\naurora",
  );
  await expect
    .poll(() =>
      page.evaluate(
        (projectId) =>
          Object.keys(localStorage).filter((key) =>
            key.startsWith("alder.txt.metadata." + projectId + ":"),
          ).length,
        id,
      ),
    )
    .toBeGreaterThan(0);
  await editor.press("Control+Home");
  for (let i = 0; i < 6; i++) await editor.press("Shift+ArrowRight");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem(
              Object.keys(localStorage).find((k) =>
                k.startsWith(
                  "alder.txt.metadata." +
                    localStorage.getItem("alder.project") +
                    ":",
                ),
              )!,
            ) || "null",
          )?.selection?.ranges?.[0]?.head,
      ),
    )
    .toBe(6);
  await page.reload();
  await openSaved(page);
  await expect(
    page.getByRole("textbox", { name: "TXT text editor", exact: true }),
  ).toBeVisible();
  await editor.focus();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("aurora");
  await editor.press("Control+Shift+p");
  const commands = page.getByRole("dialog", {
    name: "Text commands and shortcuts",
    exact: true,
  });
  await commands
    .getByRole("searchbox", { name: "Search text commands", exact: true })
    .fill("Uppercase");
  await commands
    .getByRole("button", { name: "Set shortcut for Uppercase", exact: true })
    .click();
  await commands
    .getByRole("textbox", { name: "Text command shortcut", exact: true })
    .fill("Ctrl-Alt-U");
  await commands
    .getByRole("button", { name: "Save shortcut", exact: true })
    .click();
  await commands
    .getByRole("button", { name: "Close commands", exact: true })
    .click();
  await editor.press("Control+a");
  await editor.press("Control+Alt+u");
  await expect(editor).toHaveText("AURORA ONEAURORA TWOAURORA");
  await editor.press("Control+z");
  await expect(editor).toHaveText("aurora oneaurora twoaurora");
  await page.getByRole("button", { name: "Text tools", exact: true }).click();
  await page.getByRole("button", { name: "Split view", exact: true }).click();
  const secondary = page.getByRole("textbox", {
    name: "TXT secondary view",
    exact: true,
  });
  await expect(secondary).toBeVisible();
  await secondary.press("Control+End");
  await secondary.pressSequentially("!");
  await expect(editor).toHaveText("aurora oneaurora twoaurora!");
  await editor.press("Control+z");
  await expect(editor).toHaveText("aurora oneaurora twoaurora");
  await expect(secondary).toHaveText("aurora oneaurora twoaurora");
  await page
    .getByRole("button", { name: "Close second view", exact: true })
    .click();
  await expect(
    page.getByText("Bookmarked lines (1)", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(os.tmpdir(), "alder-txt-editor-qualification.png"),
  });
  expect(errors).toEqual([]);
});
