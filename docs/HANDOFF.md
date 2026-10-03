# Handoff: Milestone 1 in progress (2026-10-03)

Branch `milestone-1`. Milestone 0 is merged in `main`. Read `CLAUDE.md`, `docs/SPEC.md` and `docs/DECISIONS.md` first. Delete this file when Milestone 1 is done.

## Done (tested: `npm run typecheck && npm run lint && npm test`)

The import pipeline's first half, as pure functions in `src/lib/import/`:

- `parse.ts`: lenient parser (SPEC §3.1). Code fence, text around the JSON, curly quotes, trailing commas, a bare pass or list of passes, a missing schemaVersion. One warning per fix. Syntax errors come from `json-syntax.ts` with line, column and a snippet, so they work in Safari too. Fixes keep the text the same length, so error positions point into what the user pasted. 256 KB limit.
- `clean.ts`: runs before validation. Tidies text (trim, single spaces, no control characters; line breaks kept in notes, offer.terms and extraFields values), drops empty values (null, "", {}, []) and attachments without a full https link, with warnings. It never touches `barcode.message` and never drops a pass, so "Pass 2" always means the second pass in the JSON.
- `validate.ts` + `messages.ts`: unknown keys are removed with a warning, and other Ajv errors become plain messages ("Pass 1 needs a title, for example the event name."). Messages key off field names, not Ajv's schemaPath, which changes when Ajv inlines refs.
- `schema-validator.generated.ts`: the Ajv validator precompiled by `npm run gen:types` (resolves D8), so the browser never needs `unsafe-eval`. A test fails if it's out of date. `ajv` is now a devDependency.
- `notices.ts`: the `Warning` type (`kind: "fix"` for things already fixed, `from: "ai"` for the AI's own warnings, `pass` for the pass index) and the `ImportError` type (optional text `location`).
- `paths.ts`: shared JSON path helpers.

## Next, in order

1. **`normalize.ts`** (SPEC §3.3), using Luxon (installed):
   - Times without an offset get the offset from `timeZone`. Detect DST gaps (the wall time changes) and overlaps (`dt.getPossibleOffsets().length > 1`) and warn.
   - With no valid `timeZone`, use a fallback zone (the browser's, or one the user picks), warn, and set a flag so the UI shows a time zone picker. An unknown zone is ignored with a warning.
   - Times that have an offset keep it: a flight's arrival is in another zone.
   - Impossible dates (`2026-13-40`) are errors.
   - A date-only `expires` becomes 23:59:59 local time. `since` and `receivedAt` are for display only.
   - Colors: put the math in `src/lib/pass/colors.ts`. Use the type defaults from SPEC §4.5. With only a background, foreground is white or black, whichever contrasts more (always 4.5:1 or better). Derive the label color by mixing the foreground toward the background until contrast stays at 4.5:1. Fix and warn when a given color fails. First check that the default label colors pass 4.5:1.
   - Code 128 gets a warning that Apple Watch can't show it.
   - Collect the AI's own warnings at import level and per pass (`from: "ai"`).
   - Then add a `processImport(text, { fallbackTimeZone })` that runs parse → clean → validate → normalize.
2. **Field layout** in `src/lib/pass/` (SPEC §4.2 and §4.4): pure functions that turn a normalized pass into header, primary, secondary, auxiliary and back fields, shaped like pass.json fields (`key`, `label`, `value`, `dateStyle`/`timeStyle` + `ignoresTimeZone`, `currencyCode`, `attributedValue`). Respect the field caps and send overflow to the back. Keys must be unique (`att_1`, `x_1`). The preview renders this now, and Milestone 2 wraps the same data into pass.json, so fields match. Warn when a front field is probably too long; the limits are estimates to confirm on a device.
3. **UI** (SPEC §10). First write a short design plan (`docs/DESIGN.md`) and check it against §10.
   - The drop zone looks like a ticket stub (perforation and paper clip): paste, drag and drop, and Choose file, keyboard accessible, debounced live processing. Errors keep the input and can jump to the error's location.
   - Copy AI prompt, with the optional ticket email box. The prompt is imported at build time: `turbopack.rules: { "*.txt": { type: "raw" } }` in `next.config.ts` plus a `declare module "*.txt"`. Never copy the prompt text into code.
   - Result cards: a Wallet-like preview (tap to flip; system font; uppercase labels only inside the preview), warnings (fixes shown quieter), and the barcode status.
   - Barcodes: bwip-js loaded with `import("bwip-js/browser")`, named encoders (`qrcode`, `pdf417`, `azteccode`, `code128`) with `drawingSVG()`, shown as a `data:` image.
   - Preview-only note: "Pass signing isn't set up yet". No fake Wallet badge: Milestone 2 uses Apple's official badge.
   - Fonts: Schibsted Grotesk via `next/font/google` (reachable at build time) for headings, the system font for everything else.
   - Add `/privacy`.
4. **Security headers**:
   - The strict CSP needs per-request nonces. Add a `src/proxy.ts` (Next 16's name for middleware) that sets the nonce CSP from `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`.
   - Make every page dynamic (`await connection()` in the root layout).
   - Add `'unsafe-eval'` and `'unsafe-inline'` styles in development only. Add `upgrade-insecure-requests` only on https.
   - Don't server-render `style=""` attributes: the previews only render on the client.
   - In `next.config.ts`: Referrer-Policy no-referrer, nosniff, `poweredByHeader: false`.
5. **Verify**: contract tests (every valid example processes and lays out, every recoverable example recovers with the warnings from `examples/README.md`, every invalid example shows readable errors). Check in a browser with Playwright (Chromium at `/opt/pw-browsers`) at 360 px and desktop widths, in light and dark mode, using the keyboard, with no CSP violations in the console. iPhone Safari needs a real device. Then add an M1 entry to `docs/DECISIONS.md`.

## Notes

- Next.js 16 differs from older versions: read `node_modules/next/dist/docs/` before writing Next.js code (see `AGENTS.md`).
- Open question for the owner: SPEC §4.2 shows only the departure time (no date) on the front of a boarding pass. I planned to add the full departure date and time on the back, next to the arrival.
