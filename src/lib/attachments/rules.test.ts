import { describe, expect, it } from "vitest";
import { attachmentTitle, checkFile, isSafeFileName, MAX_ATTACHMENT_BYTES, readDeleteFragment, safeFileName } from "./rules";

const token = "q2vXo8n0Jk3m4P5r6S7t8U9v0W1x2Y3z4A5b6C7d8E9";

describe("checkFile", () => {
  it.each([
    [{ name: "Ticket.PDF", type: "application/pdf", size: 1000 }, "application/pdf", "pdf", "Ticket.pdf"],
    [{ name: "seat map.jpeg", type: "image/jpeg", size: 1000 }, "image/jpeg", "image", "seat-map.jpg"],
    [{ name: "screenshot.png", type: "", size: 1000 }, "image/png", "image", "screenshot.png"],
    // Safari and Chrome often give HEIC photos no type, or a generic one.
    [{ name: "IMG_0042.HEIC", type: "", size: 1000 }, "image/heic", "image", "IMG_0042.heic"],
    [{ name: "IMG_0043.heic", type: "application/octet-stream", size: 1000 }, "image/heic", "image", "IMG_0043.heic"],
    [{ name: "scan", type: "application/pdf", size: 1000 }, "application/pdf", "pdf", "scan.pdf"],
  ])("accepts %o", (facts, contentType, kind, fileName) => {
    const result = checkFile(facts);
    expect(result.ok && result.file).toMatchObject({ contentType, kind, fileName, size: 1000 });
  });

  it.each([
    [{ name: "notes.txt", type: "text/plain", size: 10 }, "Choose a PDF, JPEG, PNG or HEIC file."],
    [{ name: "photo.png", type: "application/pdf", size: 10 }, "Choose a PDF, JPEG, PNG or HEIC file."],
    [{ name: "page.html", type: "", size: 10 }, "Choose a PDF, JPEG, PNG or HEIC file."],
    [{ name: "image.svg", type: "image/svg+xml", size: 10 }, "Choose a PDF, JPEG, PNG or HEIC file."],
    [{ name: "empty.pdf", type: "application/pdf", size: 0 }, "This file is empty. Choose another file."],
    [{ name: "big.pdf", type: "application/pdf", size: MAX_ATTACHMENT_BYTES + 1 }, "This file is over 10 MB. Choose a smaller file, or add a link to it in your JSON instead."],
  ])("refuses %o", (facts, message) => {
    expect(checkFile(facts)).toEqual({ ok: false, message });
  });

  it("accepts a file of exactly 10 MB", () => {
    expect(checkFile({ name: "a.pdf", type: "application/pdf", size: MAX_ATTACHMENT_BYTES }).ok).toBe(true);
  });
});

describe("file names", () => {
  it("keeps only letters, numbers, dots, hyphens and underscores", () => {
    expect(safeFileName("Café Tickets (2) – Row F.pdf", "application/pdf")).toBe("Cafe-Tickets-2-Row-F.pdf");
    expect(safeFileName("東京.pdf", "application/pdf")).toBe("file.pdf");
    expect(safeFileName("../../etc/passwd.png", "image/png")).toBe("etc-passwd.png");
    expect(safeFileName(`${"a".repeat(200)}.jpeg`, "image/jpeg")).toBe(`${"a".repeat(80)}.jpg`);
  });

  it("titles the link from the original name", () => {
    expect(attachmentTitle("Venue_map.pdf")).toBe("Venue map");
    expect(attachmentTitle("東京ドーム.pdf")).toBe("東京ドーム");
    expect(attachmentTitle(".pdf")).toBe("Attached file");
    expect(Array.from(attachmentTitle(`${"🎫".repeat(70)}.png`))).toHaveLength(60);
  });

  it("recognizes names it made, and nothing else", () => {
    expect(isSafeFileName("Cafe-Tickets-2-Row-F.pdf")).toBe(true);
    expect(isSafeFileName("file.heic")).toBe(true);
    expect(isSafeFileName("../secret.pdf")).toBe(false);
    expect(isSafeFileName("a/b.pdf")).toBe(false);
    expect(isSafeFileName("notes.txt")).toBe(false);
    expect(isSafeFileName(".pdf")).toBe(false);
  });
});

describe("readDeleteFragment", () => {
  it("reads the token and file name after the #", () => {
    expect(readDeleteFragment(`#${token}/Ticket.pdf`)).toEqual({ token, fileName: "Ticket.pdf" });
  });

  it.each([
    "",
    "#",
    `#${token}`,
    `#${token}/`,
    `#${token.slice(1)}/Ticket.pdf`,
    `#${token}/Ticket.pdf/extra`,
    `#${token}/..%2Fsecret.pdf`,
    `#${token}/notes.txt`,
  ])("refuses an incomplete or altered link: %s", (hash) => {
    expect(readDeleteFragment(hash)).toBeUndefined();
  });
});
