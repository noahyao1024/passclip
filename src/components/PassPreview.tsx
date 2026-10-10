"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import type { NormalizedPass } from "../lib/import/normalize";
import type { Barcode } from "../lib/import/types";
import { artworkCss } from "../lib/pass/artwork";
import type { PassField, PassLayout } from "../lib/pass/fields";
import { FORMAT_NAMES } from "@/lib/barcode/formats";
import { renderBarcode, type BarcodeImage } from "./barcode-preview";
import { fieldLink, formatFieldValue } from "./preview-fields";

export interface PassPreviewProps {
  pass: NormalizedPass;
  layout: PassLayout;
}

function PreviewField({ field, back = false }: { field: PassField; back?: boolean }) {
  const url = back ? fieldLink(field) : undefined;
  return (
    <div className="pass-field">
      <dt className="pass-label">{field.label}</dt>
      <dd className="pass-value">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">Open {field.label}</a>
        ) : formatFieldValue(field, { showTimeZone: back })}
      </dd>
    </div>
  );
}

function FieldRow({ fields, className }: { fields: PassField[]; className: string }) {
  return fields.length ? (
    <dl className={`pass-row ${className}`}>
      {fields.map((field) => <PreviewField key={field.key} field={field} />)}
    </dl>
  ) : null;
}

type BarcodeState =
  | { key: string; status: "encoded" | "ready"; image: BarcodeImage }
  | { key: string; status: "failed" };

function useBarcodePreview(barcode?: Barcode) {
  const format = barcode?.format;
  const message = barcode?.message;
  const key = JSON.stringify([format, message]);
  const [result, setResult] = useState<BarcodeState>();

  useEffect(() => {
    if (format === undefined || message === undefined) return;
    let cancelled = false;
    renderBarcode({ format, message }).then((result) => {
      if (!cancelled) setResult({ key, status: "encoded", image: result });
    }).catch(() => {
      // Encoder errors can contain pass data. Show a fixed message and never log them.
      if (!cancelled) setResult({ key, status: "failed" });
    });
    return () => { cancelled = true; };
  }, [format, message, key]);

  return {
    result: result?.key === key ? result : undefined,
    loaded: () => setResult((current) => current?.key === key && current.status === "encoded" ? { ...current, status: "ready" } : current),
    failed: () => setResult((current) => current?.key === key ? { key, status: "failed" } : current),
  };
}

/** Results are created after browser input, so custom-color style attributes are never server rendered. */
export function PassPreview({ pass, layout }: PassPreviewProps) {
  const [back, setBack] = useState(false);
  const previewId = useId();
  const barcode = useBarcodePreview(pass.barcode);
  // An event ticket's picture is drawn behind the whole card in Wallet; this is the same plan as CSS.
  const picture = pass.type === "eventTicket" && !back ? artworkCss(pass.style) : undefined;
  const colors = {
    "--pass-background": pass.style.backgroundColor,
    "--pass-foreground": pass.style.foregroundColor,
    "--pass-label": pass.style.labelColor,
    ...(picture ? { backgroundImage: picture } : {}),
  } as CSSProperties;

  return (
    <div className="preview-wrapper">
      <div className="preview-toolbar">
        <span className="preview-side">{back ? "Back of pass" : "Front of pass"}</span>
        <button type="button" aria-controls={previewId} onClick={() => setBack((value) => !value)}>
          {back ? "Show front" : "Show back"}
        </button>
      </div>
      <section
        id={previewId}
        className={`pass-preview ${back ? "pass-back" : "pass-front"} pass-${pass.type}`}
        style={colors}
        aria-label={`${back ? "Back" : "Front"} of ${pass.title}`}
      >
        {back ? (
          <>
            <p className="pass-brand">{pass.organization ?? pass.title}</p>
            <dl className="pass-back-fields">
              {layout.backFields.map((field) => <PreviewField key={field.key} field={field} back />)}
            </dl>
          </>
        ) : (
          <>
            <div className="pass-heading">
              <p className="pass-brand">{pass.organization ?? pass.title}</p>
              <FieldRow fields={layout.headerFields} className="pass-header" />
            </div>
            <FieldRow fields={layout.primaryFields} className="pass-primary" />
            <FieldRow fields={layout.secondaryFields} className="pass-secondary" />
            <FieldRow fields={layout.auxiliaryFields} className="pass-auxiliary" />
            {barcode.result && barcode.result.status !== "failed" && pass.barcode ? (
              <div className={`pass-barcode barcode-${pass.barcode.format}`}>
                {/* This local SVG data URL doesn't need external image optimization. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="barcode-image"
                  src={barcode.result.image.src}
                  width={barcode.result.image.width}
                  height={barcode.result.image.height}
                  alt={`${FORMAT_NAMES[pass.barcode.format]} for this pass`}
                  onLoad={barcode.loaded}
                  onError={barcode.failed}
                />
                {pass.barcode.altText ? <p className="barcode-alt">{pass.barcode.altText}</p> : null}
              </div>
            ) : null}
          </>
        )}
        <button
          type="button"
          className="pass-flip-surface"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setBack((value) => !value)}
        />
      </section>
      <div className="barcode-area">
        <p className={`barcode-status${barcode.result?.status === "failed" ? " barcode-error" : ""}`} role="status">
          {!pass.barcode ? "No barcode yet: add a screenshot" : barcode.result?.status === "failed" ? "Barcode preview unavailable" : barcode.result?.status === "ready" ? "Barcode ready" : "Rendering barcode…"}
        </p>
        {pass.barcode && barcode.result?.status === "failed" ? <p className="barcode-help">Check that the code format matches the original ticket.</p> : null}
      </div>
    </div>
  );
}
