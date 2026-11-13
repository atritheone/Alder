import { test, expect } from "@playwright/test";

test.use({
  baseURL: process.env.ALDER_TXT_TEST_URL || "http://127.0.0.1:4173",
  viewport: { width: 1600, height: 1000 },
  launchOptions: { channel: "msedge" },
});

test("fold arrows keep all gutter columns fixed with change bars beside the document", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
      const rect = (selector: string) =>
        host.querySelector(selector)!.getBoundingClientRect();
      const gutter = rect(".cm-gutters"),
        numbers = rect(".cm-lineNumbers"),
        fold = rect(".cm-foldGutter"),
        changes = rect(".txt-change-gutter"),
        content = rect(".cm-content");
      const number = Array.from(
        host.querySelectorAll(".cm-lineNumbers .cm-gutterElement"),
      ).find((el) => getComputedStyle(el).visibility !== "hidden")!;
      const range = document.createRange();
      range.selectNodeContents(number);
      return {
        gutterLeft: gutter.left,
        markerLeft: changes.left,
        markerRight: changes.right,
        arrowLeft: fold.left,
        arrowRight: fold.right,
        numbersLeft: numbers.left,
        numbersRight: numbers.right,
        numberRight: range.getBoundingClientRect().right,
        textAreaLeft: content.left,
      };
    });
  await expect(editor).toBeVisible();
  for (const font of ["Cambria", "Consolas"]) {
    await page.getByLabel("Font family", { exact: true }).selectOption(font);
    await editor.fill("");
    await expect(
      page.locator(".txt-host .txt-fold-control:visible"),
    ).toHaveCount(0);
    const before = await position();
    expect(before.arrowRight).toBeLessThanOrEqual(before.numbersLeft);
    expect(before.numbersRight).toBeLessThanOrEqual(before.markerLeft);
    expect(
      Math.abs(before.markerRight - before.textAreaLeft),
    ).toBeLessThanOrEqual(1);
    await editor.pressSequentially("First line");
    await expect(page.locator(".txt-change-marker")).toHaveCount(1);
    await expect.poll(position).toEqual(before);
    await editor.press("Enter");
    await expect(openArrow).toHaveCount(1);
    await expect.poll(position).toEqual(before);
    await editor.pressSequentially("Second line");
    await expect(
      page.locator(".txt-host .txt-fold-control:visible"),
    ).toHaveCount(0);
    await expect.poll(position).toEqual(before);
    await editor.press("Enter");
    await expect(openArrow).toHaveCount(1);
    await openArrow.click();
    await expect.poll(position).toEqual(before);
    await page
      .locator('.txt-host .cm-foldGutter [title="Unfold line"]:visible')
      .click();
    await expect.poll(position).toEqual(before);
    for (const count of [9, 10]) {
      await editor.fill(
        Array.from({ length: count }, (_, i) => "Example line " + (i + 1)).join(
          "\n",
        ),
      );
      await expect(
        page.locator(".txt-host .txt-fold-control:visible"),
      ).toHaveCount(0);
      await expect.poll(position).toEqual(before);
    }
    const background = await page
      .locator(".txt-host .cm-gutters")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).toBe("rgb(231, 231, 231)");
  }
  for (const text of [
    "Short document",
    Array.from(
      { length: 180 },
      (_, i) => `Line ${i + 1}: ` + "wrapped example words ".repeat(12),
    ).join("\n"),
  ]) {
    await editor.fill(text);
    for (const bottom of [false, true]) {
      if (bottom) await editor.press("Control+End");
      await expect
        .poll(() =>
          page.evaluate(() => {
            const host = document.querySelector(".txt-host")!;
            return Math.abs(
              host.querySelector(".cm-gutters")!.getBoundingClientRect()
                .bottom -
                host.querySelector(".cm-content")!.getBoundingClientRect()
                  .bottom,
            );
          }),
        )
        .toBeLessThanOrEqual(1);
    }
  }
  expect(errors).toEqual([]);
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
