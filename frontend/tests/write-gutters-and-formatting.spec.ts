import { test, expect } from "@playwright/test";

test.use({
  baseURL: process.env.ALDER_TXT_TEST_URL || "http://127.0.0.1:4173",
  viewport: { width: 1600, height: 1000 },
  launchOptions: { channel: "msedge" },
});

test("fold arrows do not shift change markers or line numbers", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "TXT text editor",
    exact: true,
  });
  const openArrow = page.locator(
    '.txt-host .cm-foldGutter [title="Fold line"]:visible',
  );
  const position = () =>
    page.evaluate(() => {
      const host = document.querySelector(".txt-host")!;
      return {
        marker: host
          .querySelector(".txt-change-gutter .cm-gutterElement")!
          .getBoundingClientRect().left,
        numbers: host.querySelector(".cm-lineNumbers")!.getBoundingClientRect()
          .left,
        foldWidth: host.querySelector(".cm-foldGutter")!.getBoundingClientRect()
          .width,
      };
    });
  for (const font of ["Cambria", "Consolas"]) {
    await page.getByLabel("Font family", { exact: true }).selectOption(font);
    await editor.fill("First line\nSecond line");
    await expect(openArrow).toHaveCount(0);
    const before = await position();
    const originalWidth = await page.evaluate(() => {
      const gutter = document.querySelector(".txt-host .cm-foldGutter")!;
      const spacer = document.createElement("span");
      spacer.textContent = "›";
      spacer.style.cssText =
        "position:absolute;visibility:hidden;padding:0 1px";
      gutter.appendChild(spacer);
      const width = spacer.getBoundingClientRect().width;
      spacer.remove();
      return width;
    });
    expect(before.foldWidth).toBe(originalWidth);
    await editor.press("Control+End");
    await editor.press("Enter");
    await expect(openArrow).toHaveCount(1);
    await expect.poll(position).toEqual(before);
    await openArrow.click();
    await expect.poll(position).toEqual(before);
    await page
      .locator('.txt-host .cm-foldGutter [title="Unfold line"]:visible')
      .click();
    await editor.press("Control+End");
    await editor.press("Backspace");
    await expect(openArrow).toHaveCount(0);
    await expect.poll(position).toEqual(before);
  }
});

test("formatting defaults off in Sandbox and on in DOCX and book Write", async ({
  browser,
}) => {
  for (const kind of ["docx", "book"]) {
    const context = await browser.newContext(),
      page = await context.newPage();
    await page.goto(process.env.ALDER_TXT_TEST_URL || "http://127.0.0.1:4173");
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page
      .getByRole("button", {
        name: kind === "docx" ? "Word document .docx" : "Book Chapters & pages",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Chapter text editor", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Toggle sandbox", exact: true })
      .evaluate((button) => {
        if (button.getAttribute("aria-expanded") !== "true")
          (button as HTMLButtonElement).click();
      });
    const write = page
      .locator(".book-editor")
      .getByRole("button", { name: "Show structure", exact: true });
    const sandbox = page.getByRole("textbox", {
      name: "Sandbox text editor",
      exact: true,
    });
    const sandboxToggle = sandbox
      .locator(
        'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " editor-shell ")]',
      )
      .getByRole("button", { name: "Show structure", exact: true });
    await expect(write).toHaveAttribute("aria-pressed", "true");
    await expect(sandboxToggle).toHaveAttribute("aria-pressed", "false");
    await sandboxToggle.click();
    await expect(sandboxToggle).toHaveAttribute("aria-pressed", "true");
    await expect(write).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("alder.structure.sandbox"),
      ),
    ).toBe("true");
    await context.close();
  }
});
