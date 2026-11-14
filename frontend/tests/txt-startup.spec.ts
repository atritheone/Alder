import { test, expect } from "@playwright/test";

test.use({
  baseURL: process.env.ALDER_TXT_TEST_URL || "http://127.0.0.1:4173",
  viewport: { width: 1600, height: 1000 },
  launchOptions: { channel: "msedge" },
});

test("a saved TXT session leaves New/Open available and restores behind the chosen document", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  const previousName = `Previous TXT ${Date.now()}`;
  await page.getByLabel("Name", { exact: true }).fill(previousName);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "TXT text editor",
    exact: true,
  });
  await editor.fill("Saved before closing Alder.");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const previousId = await page.evaluate(() =>
    localStorage.getItem("alder.project"),
  );
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          JSON.parse(
            localStorage.getItem("alder.txt.session") || "{}",
          ).ids?.includes(id),
        previousId,
      ),
    )
    .toBe(true);

  await page.reload();
  // Let startup requests finish: a delayed restore must not navigate away from
  // the start screen, even before the user has time to click New.
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeEnabled();
  await expect(editor).toHaveCount(0);
  await page.getByRole("button", { name: "New", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "New document",
    exact: true,
  });
  const nextName = `New TXT ${Date.now()}`;
  await dialog.getByLabel("Name", { exact: true }).fill(nextName);
  await page.waitForLoadState("networkidle");
  await expect(dialog).toBeVisible();

  let releaseRestore!: () => void;
  const restoreGate = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  let restored = false;
  await page.route(`**/api/projects/${previousId}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    await restoreGate;
    await route.fulfill({ response });
    restored = true;
  });
  try {
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(editor).toBeVisible();
    await editor.fill(
      "The chosen document stays open.\nThe current line matches the page.",
    );
    await editor.press("Control+End");
    releaseRestore();
    await expect.poll(() => restored).toBe(true);
    await expect(
      page.getByRole("tab", { name: previousName, exact: true }),
    ).toHaveAttribute("aria-selected", "false");
    await expect(
      page.getByRole("tab", { name: nextName, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(editor).toContainText("The chosen document stays open.");

    const activeLine = page.locator(".txt-paged .cm-activeLine");
    await expect(activeLine).toHaveText("The current line matches the page.");
    await expect(activeLine).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await editor.press("ArrowUp");
    await expect(activeLine).toHaveText("The chosen document stays open.");
    await expect(activeLine).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    await page.getByRole("tab", { name: previousName, exact: true }).click();
    await expect(editor).toHaveText("Saved before closing Alder.");
  } finally {
    releaseRestore();
    await page.unrouteAll({ behavior: "wait" });
  }
});
