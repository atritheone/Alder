import { test, expect } from "@playwright/test";
test.use({
  baseURL: "http://127.0.0.1:5173",
  viewport: { width: 1600, height: 1000 },
  launchOptions: { channel: "msedge" },
});
test.setTimeout(60_000);

test("clean startup, TXT creation, Aptos, help, and exact speed", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ProseMirror")).toHaveCount(0);
  await page.screenshot({ path: "work/alder-start.png" });
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Plain writing");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await editor.fill("Only these words. No generated title.");
  await expect(page.locator(".save-status")).toHaveText("All changes saved");
  const id = await page.evaluate(() => localStorage.getItem("alder.project"));
  const output = await (
    await request.post(`/api/projects/${id}/export`, {
      data: { format: "txt" },
    })
  ).json();
  expect(
    (await (await request.get(output.downloadUrl)).text()).replace(
      /\r\n/g,
      "\n",
    ),
  ).toBe("Only these words. No generated title.\n");
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('12px "Aptos"'))).toBe(
    true,
  );
  await expect(page.locator(".titlebar, .local-badge")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Hide detail", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Reading speed", { exact: true }).fill("1.03");
  await expect(page.getByLabel("Reading speed", { exact: true })).toHaveValue(
    "1.03",
  );
  const slider = page.getByRole("slider", {
    name: "Reading speed slider",
    exact: true,
  });
  await expect(slider).toHaveValue("1.03");
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(page.getByLabel("Reading speed", { exact: true })).toHaveValue(
    "1.04",
  );
  const families = (await (await request.get("/api/fonts")).json()).families;
  expect(families.length).toBeGreaterThan(5);
  const menu = page.getByLabel("Font family", { exact: true }).first();
  for (const family of families)
    await expect(
      menu
        .locator("option")
        .filter({
          hasText: new RegExp(
            `^${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          ),
        }),
    ).toHaveCount(1);
  await expect(menu).toHaveValue("Cambria");
  await expect(editor).toHaveCSS("font-family", /Cambria/);
  await expect(page.getByLabel("Reading volume", { exact: true })).toHaveValue(
    "2",
  );
  await page.getByRole("button", { name: "Toggle help area" }).click();
  await page.getByLabel("Reading speed", { exact: true }).hover();
  await expect(page.getByLabel("Context help")).toContainText("0.01");
  await page.getByRole("button", { name: "Toggle sandbox" }).hover();
  await expect(page.getByLabel("Context help")).toContainText("separate area");
  await page.screenshot({ path: "work/alder-grey-workspace.png" });
  expect(errors).toEqual([]);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".start-open")
    .getByRole("button", { name: "Plain writing", exact: true })
    .first()
    .click();
  await expect(editor).toHaveText("Only these words. No generated title.");
});

test("book setup persists layout and exports Cambria PDF and DOCX", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Book Chapters & pages" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Book layout");
  await page.getByLabel("Chapters", { exact: true }).fill("3");
  await page.getByLabel("Orientation").selectOption("landscape");
  await page.getByLabel("Start page numbering at").fill("5");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.locator(".chapter-entry")).toHaveCount(3);
  const id = await page.evaluate(() => localStorage.getItem("alder.project"));
  const project = await (await request.get(`/api/projects/${id}`)).json();
  expect(project.settings.orientation).toBe("landscape");
  expect(project.settings.firstPageNumber).toBe(5);
  for (const format of ["pdf", "docx"]) {
    const response = await request.post(`/api/projects/${id}/export`, {
      data: { format },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const result = await response.json();
    expect(result.warnings.join(" ")).not.toContain("substituted");
  }
});

test("file drops open from start and save pending workspace edits", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const drop = async (name: string, text: string) => {
    const transfer = await page.evaluateHandle(
      ({ name, text }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([text], name, { type: "text/plain" }));
        return dt;
      },
      { name, text },
    );
    await page.dispatchEvent("body", "dragover", { dataTransfer: transfer });
    await expect(page.locator(".file-drop-overlay")).toBeVisible();
    await page.dispatchEvent("body", "drop", { dataTransfer: transfer });
    await expect(page.locator(".file-drop-overlay")).toHaveCount(0);
    await transfer.dispose();
  };
  await drop("dropped.txt", "Dropped from the desktop.");
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor).toHaveText("Dropped from the desktop.");
  const first = await page.evaluate(() =>
    localStorage.getItem("alder.project"),
  );
  await editor.fill("Pending edits must survive.");
  await drop("second.txt", "Second file.");
  await expect(editor).toHaveText("Second file.");
  const saved = await (await request.get(`/api/projects/${first}`)).json();
  expect(saved.book.chapters[0].text).toBe("Pending edits must survive.");
});
