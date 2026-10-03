import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

const fixtures = path.join(process.cwd(), "examples");
const read = (file: string) => readFileSync(path.join(fixtures, file), "utf8");
const prompt = readFileSync(path.join(process.cwd(), "prompts/extract-to-passclip.txt"), "utf8");

function captureFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  return failures;
}

async function importText(page: Page, text: string) {
  await page.getByLabel("Paste the JSON from your AI chat").fill(text);
  await expect(page.getByRole("status").filter({ hasText: "Checking your reply" })).toHaveCount(0);
}

async function assertFits(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
}

test("production documents have distinct nonces and privacy navigation works", async ({ page, request }) => {
  const failures = captureFailures(page);
  const first = await page.goto("/");
  const headers = first!.headers();
  const csp = headers["content-security-policy"];
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-powered-by"]).toBeUndefined();
  const nonce = /'nonce-([^']+)'/.exec(csp)![1];
  const html = await first!.text();
  expect(html).toContain(`nonce="${nonce}"`);
  expect(html).not.toContain('style="');
  const second = await request.get("/");
  expect(second.headers()["content-security-policy"]).not.toContain(`'nonce-${nonce}'`);
  await page.getByRole("link", { name: "Privacy", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your tickets stay with you.");
  await page.getByRole("link", { name: "Passclip home" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Turn any ticket");
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(page.locator(".pass-result")).toHaveCount(2);
  await expect(page.locator(".barcode-status").filter({ hasText: "Barcode ready" })).toHaveCount(2);
  expect(failures).toEqual([]);
});

test("every valid example previews, flips and renders its exact barcode locally", async ({ page }, info) => {
  const failures = captureFailures(page);
  const posted: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") posted.push(request.url()); });
  await page.goto("/");
  for (const file of readdirSync(fixtures).filter((name) => name.endsWith(".json"))) {
    const input = read(file);
    const data = JSON.parse(input);
    await importText(page, input);
    await expect(page.locator(".pass-result")).toHaveCount(data.passes.length);
    await expect(page.locator(".import-errors")).toHaveCount(0);
    const barcodeCount = data.passes.filter((pass: { barcode?: unknown }) => pass.barcode).length;
    await expect(page.locator(".barcode-status").filter({ hasText: "Barcode ready" })).toHaveCount(barcodeCount);
    const images = page.locator(".barcode-image");
    for (let i = 0; i < barcodeCount; i++) {
      await expect(images.nth(i)).toHaveAttribute("src", /^data:image\/svg\+xml/);
      expect(await images.nth(i).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    }
    await assertFits(page);
    await page.getByRole("button", { name: "Show back", exact: true }).first().click();
    await expect(page.locator(".pass-back")).toHaveCount(1);
    if (file === "flight.json") {
      await expect(page.locator(".pass-back")).toContainText("Departure time zone");
      await expect(page.locator(".pass-back")).toContainText("Arrival time zone");
    }
    await assertFits(page);
    await page.getByRole("button", { name: "Show front", exact: true }).click();
  }
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(page.locator(".pass-result")).toHaveCount(2);
  await expect(page.locator(".barcode-status").filter({ hasText: "Barcode ready" })).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("passes.png"), fullPage: true, animations: "disabled" });
  expect(posted).toEqual([]);
  expect(failures).toEqual([]);
});

test("recoverable inputs warn, invalid inputs stay editable, and empty replies show AI warnings", async ({ page }) => {
  const failures = captureFailures(page);
  await page.goto("/");
  for (const file of readdirSync(path.join(fixtures, "recoverable"))) {
    await importText(page, read(`recoverable/${file}`));
    await expect(page.locator(".pass-result").first()).toBeVisible();
    await expect(page.locator(".import-errors")).toHaveCount(0);
    await expect(page.locator(".fix-notices").first()).toBeVisible();
  }
  for (const file of readdirSync(path.join(fixtures, "invalid"))) {
    const input = read(`invalid/${file}`);
    await importText(page, input);
    await expect(page.locator(".import-errors")).toBeVisible();
    await expect(page.getByLabel("Paste the JSON from your AI chat")).toHaveValue(input);
    await expect(page.locator(".pass-result")).toHaveCount(0);
  }
  await importText(page, '{"schemaVersion":"1.0","passes":[],"warnings":["No ticket was found in this message."]}');
  await expect(page.getByText("No passes found", { exact: true })).toBeVisible();
  await expect(page.locator(".check-notices")).toContainText("No ticket was found in this message.");
  await importText(page, '{"passes":[{"type":"eventTicket","title":"Test","start":"2026-13-40T19:00:00"}]}');
  await expect(page.locator(".import-errors")).toContainText("isn't a real date");
  await assertFits(page);
  expect(failures).toEqual([]);
});

test("copy, file selection, drop, timezone choice and syntax-location editing work", async ({ page, context }) => {
  const failures = captureFailures(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("button", { name: "Copy AI prompt" }).click();
  await expect(page.getByText("Copied the AI prompt.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
  await page.getByText("Add your ticket email", { exact: false }).click();
  await page.getByLabel("Your ticket email", { exact: true }).fill("My original ticket email");
  await page.getByRole("button", { name: "Copy AI prompt" }).click();
  await expect(page.getByText("Copied the AI prompt with your email.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${prompt}\n\nMy original ticket email`);
  await page.getByLabel("Choose an import file").setInputFiles(path.join(fixtures, "coupon.json"));
  await expect(page.locator(".pass-result")).toHaveCount(1);
  await expect(page.getByLabel("Check the time zone")).toBeVisible();
  await page.getByLabel("Check the time zone").selectOption("Asia/Tokyo");
  await expect(page.locator(".check-notices")).toContainText("Used Asia/Tokyo");
  await page.getByLabel("Choose an import file").setInputFiles({ name: "ticket.pdf", mimeType: "application/pdf", buffer: Buffer.from("not json") });
  await expect(page.locator(".error-text")).toContainText("Choose a .json or .txt");
  await page.getByLabel("Choose an import file").setInputFiles({ name: "large.txt", mimeType: "text/plain", buffer: Buffer.alloc(256 * 1024 + 1) });
  await expect(page.locator(".error-text")).toContainText("over 256 KB");
  const dropped = read("gym-membership.json");
  const transfer = await page.evaluateHandle((text) => {
    const data = new DataTransfer();
    data.items.add(new File([text], "membership.json", { type: "application/json" }));
    return data;
  }, dropped);
  await page.locator(".drop-zone").dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByLabel("Paste the JSON from your AI chat")).toHaveValue(dropped);
  await expect(page.locator(".pass-result")).toHaveCount(1);
  const invalid = '{\n  "passes": [}\n}';
  await importText(page, invalid);
  await page.getByRole("button", { name: /Go to line/ }).click();
  await expect(page.getByLabel("Paste the JSON from your AI chat")).toBeFocused();
  expect(await page.getByLabel("Paste the JSON from your AI chat").evaluate((input: HTMLTextAreaElement) => input.selectionEnd - input.selectionStart)).toBe(1);
  expect(failures).toEqual([]);
});

test("keyboard controls, reduced motion, long text and both themes fit the viewport", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByLabel("Paste the JSON from your AI chat").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Try an example" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".pass-result")).toHaveCount(2);
  await page.getByRole("button", { name: "Show back", exact: true }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".pass-back")).toHaveCount(1);
  await importText(page, JSON.stringify({ schemaVersion: "1.0", passes: [{ type: "generic", title: "Long unbroken text "+"X".repeat(60), extraFields: [{label:"Details",value:"Y".repeat(200)}] }] }));
  await expect(page.locator(".pass-result")).toHaveCount(1);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await assertFits(page);
    const background = await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);
    expect(background).toBe(colorScheme === "light" ? "rgb(233, 237, 242)" : "rgb(19, 27, 40)");
  }
  expect(await page.locator(".pass-result").evaluate((card) => getComputedStyle(card).animationName)).toBe("none");
});

test("rejected files cancel a pending read and invalid imports still show applied fixes", async ({ page }) => {
  await page.goto("/");
  await importText(page, '{"passes":[{"type":"eventTicket","color":"blue"}]}');
  await expect(page.locator(".import-errors")).toBeVisible();
  await page.locator(".fix-notices summary").click();
  await expect(page.locator(".fix-notices")).toContainText('Pass 1: Removed "color"');
  const original = await page.getByLabel("Paste the JSON from your AI chat").inputValue();
  const input = read("coupon.json");
  await page.evaluate((text) => {
    const file = new File([text], "slow.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => new Promise<string>((resolve) => {
      (window as unknown as { finishFileRead: () => void }).finishFileRead = () => resolve(text);
    }) });
    const valid = new DataTransfer();
    valid.items.add(file);
    document.querySelector(".drop-zone")!.dispatchEvent(new DragEvent("drop", { dataTransfer: valid, bubbles: true }));
    const invalid = new DataTransfer();
    invalid.items.add(new File(["invalid"], "rejected.pdf", { type: "application/pdf" }));
    document.querySelector(".drop-zone")!.dispatchEvent(new DragEvent("drop", { dataTransfer: invalid, bubbles: true }));
    (window as unknown as { finishFileRead: () => void }).finishFileRead();
  }, input);
  await expect(page.locator(".error-text")).toContainText("Choose a .json or .txt");
  await expect(page.getByLabel("Paste the JSON from your AI chat")).toHaveValue(original);
});

test("all four barcode formats render, back taps preserve links, and clipboard fallback keeps the prompt", async ({ page }) => {
  const failures = captureFailures(page);
  await page.goto("/");
  for (const format of ["qr", "pdf417", "aztec", "code128"]) {
    await importText(page, JSON.stringify({ schemaVersion: "1.0", passes: [{ type: "generic", title: format, barcode: { format, message: "  EXACT-123  " }, notes: "Back notes", attachments: [{ title: "Ticket", url: "https://ticket.example/ticket" }] }] }));
    await expect(page.getByText("Barcode ready", { exact: true })).toBeVisible();
    await page.locator(".pass-flip-surface").click();
    await expect(page.locator(".pass-back")).toHaveCount(1);
    await page.route("https://ticket.example/**", (route) => route.fulfill({ status: 200, body: "Fixture link" }));
    const newPage = page.waitForEvent("popup");
    await page.getByRole("link", { name: "Open Ticket", exact: true }).click();
    const popup = await newPage;
    await popup.close();
    await expect(page.locator(".pass-back")).toHaveCount(1);
    await page.locator(".pass-flip-surface").click();
    await expect(page.locator(".pass-front")).toHaveCount(1);
  }
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", { value: async () => { throw new Error("Clipboard denied"); } }));
  await page.getByRole("button", { name: "Copy AI prompt" }).click();
  await expect(page.getByLabel("AI prompt to copy")).toHaveValue(prompt);
  expect(failures).toEqual([]);
});
