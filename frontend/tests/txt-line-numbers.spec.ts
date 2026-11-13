import { test, expect } from "@playwright/test";

test.use({
  baseURL: process.env.ALDER_TXT_TEST_URL || "http://127.0.0.1:4173",
  viewport: { width: 1600, height: 1000 },
  launchOptions: { channel: "msedge" },
});

test("line numbers align with their first visual line through wrapping, zoom and scrolling", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill(`Line alignment ${Date.now()}`);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "TXT text editor",
    exact: true,
  });
  await editor.fill(
    Array.from({ length: 140 }, (_, i) =>
      i % 7 === 0
        ? `Logical line ${i + 1}: ` + "wrapped words ".repeat(18)
        : `Logical line ${i + 1}: short text`,
    ).join("\n"),
  );
  const alignment = () =>
    page.evaluate(() => {
      const host = document.querySelector(".txt-host")!;
      const lines = Array.from(host.querySelectorAll(".cm-line"));
      const numbers = Array.from(
        host.querySelectorAll(".cm-lineNumbers .cm-gutterElement"),
      ).filter((e) => getComputedStyle(e).visibility !== "hidden");
      return numbers.flatMap((number) => {
        const line = lines.find((l) =>
          l.textContent?.startsWith(`Logical line ${number.textContent}:`),
        );
        if (!line?.firstChild) return [];
        const numberRange = document.createRange(),
          textRange = document.createRange();
        numberRange.selectNodeContents(number);
        textRange.setStart(line.firstChild, 0);
        textRange.setEnd(line.firstChild, 1);
        const label = numberRange.getBoundingClientRect(),
          text = textRange.getBoundingClientRect();
        return [
          {
            number: number.textContent,
            error: Math.abs(label.top - text.top),
            labelTop: label.top,
            textTop: text.top,
            height: number.getBoundingClientRect().height,
            style: number.getAttribute("style"),
          },
        ];
      });
    });
  for (const font of ["Cambria", "Consolas"]) {
    await page.getByLabel("Font family", { exact: true }).selectOption(font);
    for (const zoom of ["0.5", "0.8", "1.25", "2"]) {
      await page.getByLabel("Page zoom", { exact: true }).selectOption(zoom);
      await editor.press("Control+Home");
      for (const position of ["top", "middle"]) {
        if (position === "middle") await editor.press("Control+End");
        await expect
          .poll(
            async () => {
              const rows = await alignment();
              return rows.length > 1
                ? Math.max(...rows.map((r) => r.error))
                : Infinity;
            },
            {
              message: `Aligned line numbers at ${font}, zoom ${zoom}, ${position}`,
            },
          )
          .toBeLessThanOrEqual(1);
      }
    }
  }
});
