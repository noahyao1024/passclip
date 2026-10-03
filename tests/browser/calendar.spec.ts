import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

// Milestone 4: Add to calendar downloads an .ics file through a real form navigation, with no
// signing needed.

const read = (file: string) => readFileSync(path.join(process.cwd(), "examples", file), "utf8");

async function importText(page: Page, text: string) {
  await page.getByLabel("Paste the JSON from your AI chat").fill(text);
  await expect(page.getByRole("status").filter({ hasText: "Checking your reply" })).toHaveCount(0);
}

test("Add to calendar downloads the event for tickets and travel, and only for them", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  await page.goto("/");

  await importText(page, read("flight.json"));
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".pass-result").first().getByRole("button", { name: "Add to calendar" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("Tokyo-Paris.ics");
  const body = readFileSync((await download.path())!, "utf8");
  expect(body).toContain("SUMMARY:ZQ 101 Tokyo → Paris\r\n");
  expect(body).toContain("DTSTART:20261203T012500Z\r\n");
  expect(body).toContain("TRIGGER:-PT180M\r\n");
  // The page stays put, with the preview still there.
  await expect(page.locator(".pass-result")).toHaveCount(1);

  await importText(page, read("event-tickets.json"));
  await expect(page.getByRole("button", { name: "Add to calendar" })).toHaveCount(2);
  for (const file of ["coupon.json", "loyalty-card.json", "gym-membership.json"]) {
    await importText(page, read(file));
    await expect(page.locator(".pass-result")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Add to calendar" })).toHaveCount(0);
  }
  expect(failures).toEqual([]);
});
