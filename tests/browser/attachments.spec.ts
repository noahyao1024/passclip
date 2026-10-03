import { test, expect, type Page } from "@playwright/test";
import { FAKE_STORAGE } from "./fake-storage-settings";

// Milestone 5: a file goes from the browser straight to the bucket with a signed link, its
// https link lands in the JSON and on the back of the pass, and the one-time delete link works.

const objectsUrl = `http://127.0.0.1:${FAKE_STORAGE.port}/__objects`;
const pdf = Buffer.from("%PDF-1.4\n% Passclip test file\n%%EOF\n");

function captureFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  return failures;
}

async function attach(page: Page, files: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".pass-result").first().getByRole("button", { name: "Attach a file" }).click();
  await (await chooser).setFiles(files);
}

test("a file uploads to storage, links from the pass, and its delete link deletes it", async ({ page, request }) => {
  const failures = captureFailures(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(page.locator(".pass-result")).toHaveCount(2);
  const firstPass = page.locator(".pass-result").first();
  await expect(firstPass.getByText("Anyone who has the pass can open files you attach.")).toBeVisible();

  await attach(page, { name: "Venue map.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.locator(".edit-notice")).toHaveText("Attached “Venue map” to pass 1. Its link is in your JSON above and on the back of the pass.");

  // The JSON now links to the public copy, in a random folder.
  const json = JSON.parse(await page.getByLabel("Paste the JSON from your AI chat").inputValue());
  const link = json.passes[0].attachments.at(-1);
  expect(link).toEqual({ title: "Venue map", url: expect.stringMatching(new RegExp(`^${FAKE_STORAGE.publicUrl}/[0-9a-f]{32}/Venue-map\\.pdf$`)), kind: "pdf" });
  const key = link.url.slice(`${FAKE_STORAGE.publicUrl}/`.length);

  // The bucket has exactly the bytes, with the signed type.
  expect((await (await request.get(objectsUrl)).json())[key]).toEqual({ type: "application/pdf", size: pdf.length });

  // The delete link is shown once, with a way to copy it.
  const deleteLinks = page.getByRole("region", { name: "Save your delete links" });
  const deleteInput = deleteLinks.getByLabel("Delete link for Venue map");
  const deleteUrl = await deleteInput.inputValue();
  expect(deleteUrl).toMatch(/^http:\/\/127\.0\.0\.1:3100\/delete-file#[A-Za-z0-9_-]{43}\/Venue-map\.pdf$/);
  expect(deleteUrl).not.toContain(key.split("/")[0]);

  await page.goto(deleteUrl);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Delete this file?");
  await expect(page.getByText("Venue-map.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Delete this file" }).click();
  await expect(page).toHaveURL(/\/delete-file\?deleted=1$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("File deleted.");
  expect((await (await request.get(objectsUrl)).json())[key]).toBeUndefined();
  expect(failures).toEqual([]);
});

test("files Passclip can't attach are refused before anything is uploaded", async ({ page }) => {
  const failures = captureFailures(page);
  const sent: string[] = [];
  page.on("request", (item) => { if (item.method() !== "GET") sent.push(item.url()); });
  await page.goto("/");
  await page.getByRole("button", { name: "Try an example" }).click();
  await attach(page, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.locator(".pass-result").first().getByRole("alert")).toHaveText("Choose a PDF, JPEG, PNG or HEIC file.");
  expect(sent).toEqual([]);
  expect(failures).toEqual([]);
});

test("an incomplete delete link explains how to fix it", async ({ page }) => {
  await page.goto("/delete-file#not-a-token/file.pdf");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This delete link is incomplete.");
  await expect(page.getByRole("button", { name: "Delete this file" })).toHaveCount(0);
});
