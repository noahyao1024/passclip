"use client";

import { useId, useRef, useState } from "react";
import type { DecodedCode } from "@/lib/barcode/decode";
import { MAX_IMAGE_BYTES, readImagePixels } from "@/lib/barcode/image";
import type { Barcode } from "@/lib/import/types";

// Barcode helper (docs/SPEC.md §7): read codes from a screenshot on this device, or type one.
// Nothing is used until the person taps a button (CLAUDE.md rule 3).

const FORMAT_NAMES: Record<Barcode["format"], string> = { qr: "QR code", pdf417: "PDF417", aztec: "Aztec", code128: "Code 128" };

type ReadState =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "found"; codes: DecodedCode[] }
  | { kind: "problem"; message: string };

const sameCode = (a: Pick<Barcode, "format" | "message">, b: Pick<Barcode, "format" | "message">) =>
  a.format === b.format && a.message === b.message;

export function BarcodeHelper({ current, onUse }: { current?: Barcode; onUse: (code: DecodedCode) => void }) {
  const [state, setState] = useState<ReadState>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [typedFormat, setTypedFormat] = useState<Barcode["format"]>("qr");
  const [typedMessage, setTypedMessage] = useState("");
  // With a barcode already in the JSON, checking it is optional, so the helper starts folded away.
  const [open, setOpen] = useState(!current);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const id = useId();

  async function read(files: FileList | File[]) {
    const ticket = ++request.current;
    setDragging(false);
    const file = files[0];
    if (files.length !== 1 || !file) return setState({ kind: "problem", message: "Choose one image at a time." });
    if (!file.type.startsWith("image/")) return setState({ kind: "problem", message: "Choose an image file, like a screenshot (PNG or JPEG)." });
    if (file.size > MAX_IMAGE_BYTES) return setState({ kind: "problem", message: "This image is over 25 MB. Take a screenshot of the code and use that instead." });
    setState({ kind: "reading" });
    setOpen(true);
    try {
      const [pixels, { decodeBarcodes }] = await Promise.all([readImagePixels(file), import("@/lib/barcode/decode")]);
      // Let the "Reading" status paint before the decoder keeps the page busy.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const codes = decodeBarcodes(pixels);
      if (ticket !== request.current) return;
      setState(codes.length > 0
        ? { kind: "found", codes }
        : { kind: "problem", message: "No barcode found. Try a sharper screenshot that shows the whole code, or type the code below." });
    } catch {
      if (ticket === request.current) {
        setState({ kind: "problem", message: "This image couldn’t be opened here. Take a screenshot of the code (PNG or JPEG) and try that." });
      }
    }
  }

  const differs = state.kind === "found" && current !== undefined && state.codes.some((code) => !sameCode(code, current));

  return (
    <div
      className={`barcode-helper${dragging ? " is-dragging" : ""}`}
      onDragOver={(event) => { event.preventDefault(); if (event.dataTransfer.types.includes("Files")) setDragging(true); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); void read(event.dataTransfer.files); }}
    >
      {current && (
        <button className="text-button barcode-helper-toggle" type="button" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen((value) => !value)}>
          Check the code against a screenshot
        </button>
      )}
      <div id={`${id}-panel`} hidden={!open}>
        <p className="barcode-helper-intro">
          {current ? "Choose a screenshot of your original ticket to compare." : "Add a screenshot or photo of the code from your ticket."}{" "}
          It’s read on this device and never uploaded.
        </p>
        <button className="button button-secondary" type="button" disabled={state.kind === "reading"} onClick={() => input.current?.click()}>
          Choose screenshot
        </button>
        <input ref={input} type="file" accept="image/*" className="visually-hidden" tabIndex={-1} aria-label="Choose a screenshot of the barcode"
          onChange={(event) => { if (event.target.files?.length) void read(event.target.files); event.target.value = ""; }} />
        <p className="barcode-helper-status" role="status">
          {state.kind === "reading" ? "Reading the image…" : state.kind === "found" ? `Found ${state.codes.length} ${state.codes.length === 1 ? "code" : "codes"}.` : ""}
        </p>
        {state.kind === "problem" && <p className="error-text" role="alert">{state.message}</p>}

        {differs && <p className="barcode-helper-note">Your JSON has a different code. Choose the one that matches your ticket.</p>}
        {state.kind === "found" && (
          <ul className="decoded-codes">
            {differs && current && (
              <li className="decoded-code from-json">
                <span className="decoded-source">From your JSON · {FORMAT_NAMES[current.format]}</span>
                <code>{current.message}</code>
                <button className="text-button" type="button" onClick={() => setState({ kind: "idle" })}>Keep this code</button>
              </li>
            )}
            {state.codes.map((code, index) => (
              <li className="decoded-code" key={`${code.format}-${index}`}>
                <span className="decoded-source">From your screenshot · {FORMAT_NAMES[code.format]}</span>
                <code>{code.message}</code>
                {current && sameCode(code, current)
                  ? <span className="decoded-match">Matches the code in your JSON.</span>
                  : <button className="button button-primary" type="button" onClick={() => onUse(code)}>Use this code</button>}
              </li>
            ))}
          </ul>
        )}

        <details className="typed-code">
          <summary>Type the code instead</summary>
          <p className="typed-code-warning">Type every character exactly as printed. One wrong character makes the pass useless at the door.</p>
          <label className="input-label" htmlFor={`${id}-format`}>Code type</label>
          <select id={`${id}-format`} value={typedFormat} onChange={(event) => setTypedFormat(event.target.value as Barcode["format"])}>
            {Object.entries(FORMAT_NAMES).map(([format, name]) => <option key={format} value={format}>{name}</option>)}
          </select>
          <label className="input-label" htmlFor={`${id}-message`}>Code text</label>
          <input id={`${id}-message`} type="text" value={typedMessage} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off"
            onChange={(event) => setTypedMessage(event.target.value)} />
          <button className="button button-secondary" type="button" disabled={!typedMessage.trim()}
            onClick={() => onUse({ format: typedFormat, message: typedMessage })}>
            Use this typed code
          </button>
        </details>
      </div>
    </div>
  );
}
