import { test, expect } from "@playwright/test";
test.use({
  baseURL: process.env.ALDER_TXT_TEST_URL || "http://127.0.0.1:4173",
  launchOptions: { channel: "msedge" },
});
test("TXT accepts composition, combining characters and right-to-left text without altering export", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "TXT text editor",
    exact: true,
  });
  await editor.focus();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "に",
    selectionStart: 1,
    selectionEnd: 1,
  });
  await cdp.send("Input.insertText", { text: "日本" });
  await expect(editor).toHaveText("日本");
  await cdp.send("Input.insertText", { text: " e\u0301 😀 العربية עברית" });
  const expected = "日本 e\u0301 😀 العربية עברית";
  await expect(editor).toHaveText(expected);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const id = await page.evaluate(() => localStorage.getItem("alder.project"));
  const response = await page.request.post(`/api/projects/${id}/export`, {
      data: { format: "txt" },
    }),
    result = await response.json();
  expect(await (await page.request.get(result.downloadUrl)).text()).toBe(
    expected,
  );
  await editor.press("Control+z");
  await expect(editor).toHaveText("");
  await editor.press("Control+y");
  await expect(editor).toHaveText(expected);
});
