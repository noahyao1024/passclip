import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import bwipjs from "bwip-js/node";
import { PNG } from "pngjs";

// Milestone 3: screenshots are read in the browser, nothing is uploaded, and a code is used only
// after the person chooses it.

const read = (file: string) => readFileSync(path.join(process.cwd(), "examples", file), "utf8");
const BCIDS = {
  qr: "qrcode", pdf417: "pdf417", aztec: "azteccode", code128: "code128",
  ean13: "ean13", code39: "code39", codabar: "rationalizedCodabar", itf: "interleaved2of5",
} as const;
type Format = keyof typeof BCIDS;

async function screenshot(codes: [Format, string][]): Promise<Buffer> {
  const images = await Promise.all(codes.map(async ([format, text]) =>
    PNG.sync.read(await bwipjs.toBuffer({ bcid: BCIDS[format], text, scale: 3, padding: 10, backgroundcolor: "FFFFFF", ...(format === "qr" || format === "pdf417" || format === "aztec" ? {} : { height: 15 }) }))));
  const gap = 60;
  const canvas = new PNG({ width: images.reduce((sum, image) => sum + image.width + gap, gap), height: Math.max(...images.map((image) => image.height)) + gap * 2 });
  canvas.data.fill(255);
  let x = gap;
  for (const image of images) {
    PNG.bitblt(image, canvas, 0, 0, image.width, image.height, x, gap);
    x += image.width + gap;
  }
  return PNG.sync.write(canvas);
}

function captureFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  // Warnings count too: decoding must stay quiet in people's consoles.
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") failures.push(message.text()); });
  return failures;
}

/** Everything the page fetches after this point, apart from its own scripts and styles. */
function watchUploads(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() !== "GET" || request.postData() || !url.pathname.startsWith("/_next/static/")) requests.push(`${request.method()} ${url.pathname}`);
  });
  return requests;
}

async function importText(page: Page, text: string) {
  await page.getByLabel("Paste the JSON from your AI chat").fill(text);
  await expect(page.getByRole("status").filter({ hasText: "Checking your reply" })).toHaveCount(0);
}

const chooseScreenshot = (page: Page, card: number, buffer: Buffer, name = "ticket.png", mimeType = "image/png") =>
  page.getByLabel("Choose a screenshot of the barcode").nth(card).setInputFiles({ name, mimeType, buffer });

const json = (page: Page) => page.getByLabel("Paste the JSON from your AI chat").inputValue().then((text) => JSON.parse(text));

test("every supported format, including iOS 27's, is read on the device and only used after choosing it", async ({ page }) => {
  const failures = captureFailures(page);
  await page.goto("/");
  const cases: [Format, string][] = [
    ["qr", "R-55120-QR"],
    ["pdf417", "M1TANAKA/AIKO MS EQ7XK2P HNDCDGZQ 0101 337Y034K0042 100"],
    ["aztec", "R-55120-AZTEC"],
    ["code128", "R55120CODE128"],
    ["ean13", "4006381333931"],
    ["codabar", "A40156B"],
  ];
  for (const [format, message] of cases) {
    await importText(page, read("train-local-time.json"));
    const card = page.locator(".pass-result").first();
    await expect(card.locator(".barcode-status")).toHaveText("No barcode yet: add a screenshot");
    const uploads = watchUploads(page);
    await chooseScreenshot(page, 0, await screenshot([[format, message]]));
    await expect(card.getByRole("status").filter({ hasText: "Found 1 code." })).toBeVisible();
    await expect(card.locator(".decoded-code code")).toHaveText(message);
    // Nothing changes until the person chooses the code.
    expect((await json(page)).passes[0].barcode).toBeUndefined();
    await card.getByRole("button", { name: "Use this code" }).click();
    await expect(page.locator(".edit-notice")).toHaveText("Added the code to pass 1. You can see it in your JSON above.");
    expect((await json(page)).passes[0].barcode).toEqual({ format, message });
    await expect(page.locator(".pass-result").first().locator(".barcode-status")).toHaveText("Barcode ready");
    expect(uploads).toEqual([]);
  }
  expect(failures).toEqual([]);
});

test("a different code makes the person choose, and a matching one is confirmed", async ({ page }) => {
  const failures = captureFailures(page);
  await page.goto("/");
  const tickets = read("event-tickets.json");
  const original = JSON.parse(tickets).passes[0].barcode;
  await importText(page, tickets);
  const first = () => page.locator(".pass-result").first();

  // With a barcode already in the JSON, the optional check starts folded away.
  const toggle = first().getByRole("button", { name: "Check the code against a screenshot" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(first().getByRole("button", { name: "Choose screenshot" })).toBeHidden();
  await toggle.click();
  await expect(first().getByRole("button", { name: "Choose screenshot" })).toBeVisible();
  await toggle.click();
  await chooseScreenshot(page, 0, await screenshot([["qr", original.message]]));
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(first().getByText("Matches the code in your JSON.")).toBeVisible();
  await expect(first().getByRole("button", { name: "Use this code" })).toHaveCount(0);

  await chooseScreenshot(page, 0, await screenshot([["qr", "DIFFERENT-CODE"]]));
  await expect(first().getByText("Your JSON has a different code. Choose the one that matches your ticket.")).toBeVisible();
  await expect(first().locator(".decoded-code.from-json code")).toHaveText(original.message);
  await first().getByRole("button", { name: "Keep this code" }).click();
  await expect(first().locator(".decoded-code")).toHaveCount(0);
  expect((await json(page)).passes[0].barcode).toEqual(original);

  await chooseScreenshot(page, 0, await screenshot([["qr", "DIFFERENT-CODE"]]));
  await first().getByRole("button", { name: "Use this code" }).click();
  await expect(page.locator(".edit-notice")).toContainText("pass 1");
  const after = await json(page);
  expect(after.passes[0].barcode).toEqual({ format: "qr", message: "DIFFERENT-CODE" });
  expect(after.passes[1].barcode).toEqual(JSON.parse(tickets).passes[1].barcode);
  expect(failures).toEqual([]);
});

test("several codes are all listed, typed codes carry a warning, and bad images are explained", async ({ page }) => {
  const failures = captureFailures(page);
  await page.goto("/");
  await importText(page, read("train-local-time.json"));
  const card = page.locator(".pass-result").first();

  await chooseScreenshot(page, 0, await screenshot([["qr", "FIRST"], ["aztec", "SECOND"]]));
  await expect(card.getByRole("status").filter({ hasText: "Found 2 codes." })).toBeVisible();
  await expect(card.locator(".decoded-code code")).toHaveText(["FIRST", "SECOND"]);

  const blank = new PNG({ width: 300, height: 200 });
  blank.data.fill(255);
  await chooseScreenshot(page, 0, PNG.sync.write(blank));
  await expect(card.getByRole("alert")).toHaveText("No barcode found. Try a sharper screenshot that shows the whole code, or type the code below.");
  await chooseScreenshot(page, 0, Buffer.from("not an image"), "notes.txt", "text/plain");
  await expect(card.getByRole("alert")).toHaveText("Choose an image file, like a screenshot (PNG or JPEG).");
  await chooseScreenshot(page, 0, Buffer.from("not really a png"), "broken.png");
  await expect(card.getByRole("alert")).toContainText("This image couldn’t be opened here.");

  await card.getByText("Type the code instead").click();
  await expect(card.getByText("One wrong character makes the pass useless at the door.")).toBeVisible();
  const use = card.getByRole("button", { name: "Use this typed code" });
  await expect(use).toBeDisabled();
  await card.getByLabel("Code type").selectOption("code128");
  await card.getByLabel("Code text").fill("R-55120 12D");
  await use.click();
  expect((await json(page)).passes[0].barcode).toEqual({ format: "code128", message: "R-55120 12D" });
  await expect(page.locator(".pass-result").first().locator(".barcode-status")).toHaveText("Barcode ready");
  expect(failures).toEqual([]);
});
