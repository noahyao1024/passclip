"use client";

import { useEffect, useRef, useState } from "react";
import eventTickets from "../../examples/event-tickets.json";
import { processImport } from "@/lib/import/process";
import { MAX_INPUT_BYTES } from "@/lib/import/parse";
import type { Warning } from "@/lib/import/notices";
import { layoutPass } from "@/lib/pass/fields";
import { PassPreview } from "./PassPreview";
import { ArrowMark, ClipMark, TicketMark } from "./Marks";

const exampleText = JSON.stringify(eventTickets, null, 2);
type Result = ReturnType<typeof processImport>;

function Warnings({ warnings }: { warnings: Warning[] }) {
  const checks = warnings.filter((warning) => warning.kind !== "fix");
  const fixes = warnings.filter((warning) => warning.kind === "fix");
  return <>
    {checks.length > 0 && <div className="check-notices"><h3>Check these details</h3><ul>{checks.map((warning, i) => <li key={i}>{warning.from === "ai" && <span className="notice-source">From your AI: </span>}{warning.message}</li>)}</ul></div>}
    {fixes.length > 0 && <details className="fix-notices"><summary>{fixes.length} {fixes.length === 1 ? "change" : "changes"} already applied</summary><ul>{fixes.map((warning, i) => <li key={i}>{warning.message}</li>)}</ul></details>}
  </>;
}

export default function DropSite({ prompt, walletAvailable = false, development = false }: { prompt: string; walletAvailable?: boolean; development?: boolean }) {
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [processing, setProcessing] = useState(false);
  const [timeZone, setTimeZone] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [manualCopy, setManualCopy] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileRequest = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!text.trim()) {
        setResult(null);
      } else {
        const fallbackTimeZone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        setResult(processImport(text, { fallbackTimeZone }));
      }
      setProcessing(false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [text, timeZone]);

  function changeText(value: string) {
    fileRequest.current++;
    setText(value);
    setResult(null);
    setFileError("");
    setProcessing(Boolean(value.trim()));
  }

  async function readFile(files: FileList | File[]) {
    const request = ++fileRequest.current;
    setDragging(false);
    if (files.length !== 1) {
      setFileError("Choose one .json or .txt file at a time.");
      return;
    }
    const file = files[0];
    if (!/\.(json|txt)$/i.test(file.name)) {
      setFileError("Choose a .json or .txt file containing the AI's reply.");
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      setFileError("This file is over 256 KB. Choose a smaller file with only the AI's JSON reply.");
      return;
    }
    try {
      const value = await file.text();
      if (request === fileRequest.current) changeText(value);
    } catch {
      if (request === fileRequest.current) setFileError("This file couldn't be read. Open it and paste its text here.");
    }
  }

  const copyText = email.trim() ? `${prompt}\n\n${email}` : prompt;
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(copyText);
      setManualCopy(false);
      setCopyStatus(email.trim() ? "Copied the AI prompt with your email." : "Copied the AI prompt.");
    } catch {
      setManualCopy(true);
      setCopyStatus("Select the prompt below and copy it to your AI chat.");
    }
  }

  const importWarnings = result
    ? result.ok
      ? result.warnings.filter((warning) => warning.pass === undefined)
      : result.warnings.map((warning) => warning.pass === undefined ? warning : { ...warning, message: `Pass ${warning.pass + 1}: ${warning.message}` })
    : [];
  const needsTimeZone = result?.ok && result.value.passes.some((pass) => pass.needsTimeZone);
  const selectedZone = timeZone || (result?.ok ? result.value.passes.find((pass) => pass.needsTimeZone)?.timeZone : undefined) || "UTC";
  const zones = Array.from(new Set([selectedZone, "UTC", ...Intl.supportedValuesOf("timeZone")]));

  return <main id="main" className="page-shell">
    <section className="hero" aria-labelledby="hero-title">
      <p className="eyebrow"><span className="small-clip"><ClipMark /></span> A little less digging for your ticket.</p>
      <h1 id="hero-title">Turn any ticket into an <span>Apple Wallet pass.</span></h1>
      <p className="hero-description">Your ticket has the details. Bring them here and see how they fit.</p>
    </section>

    <div className="import-workspace">
      <section className={`drop-zone${dragging ? " is-dragging" : ""}`} aria-labelledby="drop-title"
        onDragOver={(event) => { event.preventDefault(); if (event.dataTransfer.types.includes("Files")) setDragging(true); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); void readFile(event.dataTransfer.files); }}>
        <span className="paper-clip" aria-hidden="true" />
        <div className="drop-heading"><div><p className="step-caption">Your reply goes here</p><h2 id="drop-title">Drop the details.</h2></div><span className="local-badge">Stays in your browser</span></div>
        <label htmlFor="import-text" className="input-label">Paste the JSON from your AI chat</label>
        <textarea id="import-text" ref={textarea} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={text}
          placeholder={'{\n  "schemaVersion": "1.0",\n  "passes": [ ... ]\n}'}
          onChange={(event) => changeText(event.target.value)} aria-describedby="input-help"
          aria-invalid={Boolean(result && !result.ok)} />
        <div className="drop-actions"><button className="button button-secondary" onClick={() => fileInput.current?.click()}>Choose file</button><span id="input-help">or drop a .json or .txt file · up to 256 KB</span></div>
        <input ref={fileInput} type="file" className="visually-hidden" accept=".json,.txt,application/json,text/plain" tabIndex={-1} aria-label="Choose an import file" onChange={(event) => { if (event.target.files?.length) void readFile(event.target.files); event.target.value = ""; }} />
        <div className="ticket-bottom"><span>Messy AI replies welcome. We’ll show what we fix.</span><button className="text-button" onClick={() => changeText(exampleText)}>Try an example</button>{text && <button className="text-button" onClick={() => changeText("")}>Clear</button>}</div>
        {fileError && <p className="error-text" role="alert">{fileError}</p>}
      </section>

      <aside className="ai-helper" aria-labelledby="ai-title">
        <p className="step-caption">Start with any AI chat</p><h2 id="ai-title">Let your ticket do the talking.</h2>
        <ol className="how-it-works"><li><span>1</span><div><strong>Copy our prompt</strong><p>It tells the AI which details to look for.</p></div></li><li><span>2</span><div><strong>Ask any AI</strong><p>Paste the prompt with your ticket email.</p></div></li><li><span>3</span><div><strong>Drop the reply here</strong><p>Check the details in a live pass preview.</p></div></li></ol>
        <details className="email-helper"><summary>Add your ticket email <span>(optional)</span></summary><label htmlFor="ticket-email" className="input-label">Your ticket email</label><textarea id="ticket-email" value={email} onChange={(event) => { setEmail(event.target.value); setCopyStatus(""); }} placeholder="Paste your email here to copy it with the prompt." /><p>This text stays in your browser.</p></details>
        <button className="button button-primary copy-button" onClick={() => void copyPrompt()}>Copy AI prompt <ArrowMark /></button>
        <p className="copy-status" role="status">{copyStatus}</p>
        {manualCopy && <textarea className="manual-prompt" aria-label="AI prompt to copy" readOnly value={copyText} onFocus={(event) => event.target.select()} />}
        <p className="privacy-note">Your email goes to the AI service you choose. Remove anything you don’t want to share.</p>
      </aside>
    </div>

    <section className="results-section" aria-labelledby="results-title" aria-busy={processing}>
      <div className="results-heading"><h2 id="results-title">Your passes</h2><p role="status">{processing ? "Checking your reply…" : result?.ok ? `${result.value.passes.length} ${result.value.passes.length === 1 ? "pass" : "passes"} found` : "Preview before you pocket it."}</p></div>
      {!result && !processing && <div className="results-empty"><span><TicketMark /></span><p>Good things come in small passes.</p><p>Paste a reply above to see yours here.</p></div>}
      {result && !result.ok && <div className="import-errors" role="alert"><h3>Fix these details in your reply</h3><ul>{result.errors.map((error, i) => <li key={i}><p>{error.message}</p>{error.location && <><button className="text-button" onClick={() => { textarea.current?.focus(); textarea.current?.setSelectionRange(error.location!.offset, error.location!.offset + 1); }}>Go to line {error.location.line}, column {error.location.column}</button><pre>{error.location.snippet}</pre></>}</li>)}</ul></div>}
      <Warnings warnings={importWarnings} />
      {needsTimeZone && <div className="zone-picker"><label htmlFor="fallback-zone">Check the time zone</label><p>Some times arrived without a time zone. We used your browser’s zone; choose where the event or departure happens.</p><select id="fallback-zone" value={selectedZone} onChange={(event) => { setTimeZone(event.target.value); setProcessing(true); }}>{zones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}</select></div>}
      {result?.ok && result.value.passes.length === 0 && <div className="results-empty"><p>No passes found</p><p>Ask your AI to extract a ticket, booking, membership or coupon, then paste its reply here.</p></div>}
      {result?.ok && result.value.passes.length > 0 && <>
        <p className="preview-note">{!walletAvailable ? "Preview only · Pass signing isn’t set up yet. " : "Adding to Wallet sends the selected pass to our signing server. "}Check every detail against your original ticket.</p>
        <div className="pass-results">{result.value.passes.map((pass, index) => {
          const layout = layoutPass(pass, { source: result.value.source });
          const warnings = [...result.warnings.filter((warning) => warning.pass === index), ...layout.warnings];
          const { needsTimeZone: _needsTimeZone, ...payload } = pass;
          void _needsTimeZone;
          const importText = JSON.stringify({ schemaVersion: "1.0", source: result.value.source, passes: [payload] });
          return <article className="pass-result" key={`${index}-${pass.type}`}><div className="pass-result-heading"><span>Pass {index + 1}</span><h3>{pass.title}</h3></div><PassPreview pass={pass} layout={layout} /><Warnings warnings={warnings} /><div className="pass-actions"><form method="post" action="/api/pass" target="_self"><input type="hidden" name="import" value={importText} /><input type="hidden" name="fallbackTimeZone" value={pass.timeZone ?? "UTC"} /><button className="button button-secondary" disabled={!walletAvailable}>Add to Apple Wallet</button></form>{pass.start && pass.calendar?.add !== false && <button className="button button-secondary" disabled>Add to calendar</button>}{development && <button className="text-button" onClick={async () => {
            const { mapToPassJson } = await import("@/lib/pass/map");
            const json = mapToPassJson(pass, { passTypeIdentifier: "pass.preview.unconfigured", teamIdentifier: "UNCONFIGURED", serialNumber: crypto.randomUUID(), source: result.value.source });
            const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }));
            const link = document.createElement("a"); link.href = url; link.download = "pass.json"; link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>Download pass.json</button>}</div><p className="action-note">{walletAvailable ? "On a computer, send the downloaded file to your iPhone with AirDrop, Messages or email." : "Pass signing isn't set up yet."}{pass.start && pass.calendar?.add !== false && " Calendar files are coming in a later milestone."}</p></article>;
        })}</div>
      </>}
    </section>
  </main>;
}
