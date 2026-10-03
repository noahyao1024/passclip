"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ATTACHMENT_ACCEPT, checkFile, MAX_ATTACHMENTS_PER_PASS, MAX_UPLOADS_PER_PASS } from "@/lib/attachments/rules";
import type { UploadPlan } from "@/lib/attachments/storage";

// Attach a file to the back of a pass (docs/SPEC.md §9). The file goes from this browser
// straight to the storage bucket, using a link the server signs for this one file.

type State =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; percent: number }
  | { kind: "problem"; message: string };

const NOT_FINISHED = "The upload didn’t finish. Check your connection and try again.";

/** Sends the file with progress updates. Resolves when storage has it. */
function send(file: File, upload: UploadPlan["upload"], onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(upload.method, upload.url);
    for (const [name, value] of Object.entries(upload.headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(NOT_FINISHED)));
    request.onerror = () => reject(new Error(NOT_FINISHED));
    request.onabort = () => reject(new Error(NOT_FINISHED));
    request.send(file);
  });
}

export function AttachFile({ uploaded, total, onUploaded }: {
  /** Files already uploaded to this pass. */
  uploaded: number;
  /** Links of any kind already on this pass. */
  total: number;
  onUploaded: (file: { attachment: UploadPlan["attachment"]; deleteUrl: string }) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(onUploaded);
  const id = useId();
  useEffect(() => { latest.current = onUploaded; });

  const full = uploaded >= MAX_UPLOADS_PER_PASS
    ? `You’ve attached ${MAX_UPLOADS_PER_PASS} files to this pass, the most it can take.`
    : total >= MAX_ATTACHMENTS_PER_PASS
      ? `This pass already has ${MAX_ATTACHMENTS_PER_PASS} links, the most it can hold.`
      : "";

  async function attach(file: File) {
    const checked = checkFile({ name: file.name, type: file.type, size: file.size });
    if (!checked.ok) return setState({ kind: "problem", message: checked.message });
    setState({ kind: "uploading", name: file.name, percent: 0 });
    try {
      const response = await fetch("/api/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
      });
      const body = await response.json().catch(() => undefined) as (UploadPlan & { errors?: { message: string }[] }) | undefined;
      if (!response.ok || !body?.upload) throw new Error(body?.errors?.[0]?.message ?? "Couldn’t start the upload. Try again in a moment.");
      await send(file, body.upload, (percent) => setState({ kind: "uploading", name: file.name, percent }));
      setState({ kind: "idle" });
      // The delete link uses the address this page is on, which is the one the person knows.
      latest.current({ attachment: body.attachment, deleteUrl: new URL(body.deletePath, window.location.origin).href });
    } catch (error) {
      setState({ kind: "problem", message: error instanceof Error && error.message ? error.message : NOT_FINISHED });
    }
  }

  const uploading = state.kind === "uploading";
  return (
    <div className="attach-file">
      <p className="attach-file-intro">Clip a ticket PDF or photo to the back of the pass.</p>
      <button className="button button-secondary" type="button" disabled={uploading || Boolean(full)} aria-describedby={`${id}-note`} onClick={() => input.current?.click()}>
        {uploading ? "Uploading…" : "Attach a file"}
      </button>
      <input ref={input} type="file" className="visually-hidden" accept={ATTACHMENT_ACCEPT} tabIndex={-1} aria-label="Choose a file to attach"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void attach(file); }} />
      <p id={`${id}-note`} className="attach-file-note">{full || "PDF, JPEG, PNG or HEIC, up to 10 MB. Anyone who has the pass can open files you attach."}</p>
      <p className="attach-file-status" role="status">{uploading ? `Uploading ${state.name}… ${state.percent}%` : ""}</p>
      {state.kind === "problem" && <p className="error-text" role="alert">{state.message}</p>}
    </div>
  );
}
