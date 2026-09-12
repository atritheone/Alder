import type { Page } from "@playwright/test";
export async function openSaved(page: Page) {
  const name = await page.evaluate(async () => {
    const id = localStorage.getItem("alder.project");
    const project = await (await fetch(`/api/projects/${id}`)).json();
    return project.name as string;
  });
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".start-open")
    .getByRole("button", { name, exact: true })
    .first()
    .click();
}
