# Handoff: Milestone 1 implementation complete (2026-10-03)

Continue on `milestone-1`. Read `CLAUDE.md`, `docs/SPEC.md`, `docs/DECISIONS.md` and `docs/DESIGN.md` first. The original parser handoff is now implemented through the drop site. This note remains because real iPhone Safari acceptance has not yet been checked.

## Implemented

- Shared `processImport`: parse → clean → validate → normalize, preserving barcodes and explicit offsets, with readable errors and warnings for every fix. Timezone picker, DST warnings, date-only expiry and accessible colors.
- Pure `layoutPass` front/back fields for all five types, caps/overflow, escaped HTTPS attachments, unique keys and five normalized snapshots. Boarding departure time is on the front; full date/time and the correct zone are on the back, as agreed with the owner.
- Paste/file/drop interface, debounced previews, quiet applied fixes, AI warnings, error-location focus, exact Copy AI prompt with optional browser-local email, all four barcode formats, reversible preview flip and usable back links. Wallet downloads, screenshot decoding and calendar files are visibly unavailable until their milestones.
- Privacy page, per-document nonce CSP, dynamic Next 16 rendering, security headers, local licensed display font and metadata icon. No ticket content is transmitted or stored by the app.

## Verified

`npm run typecheck && npm run lint && npm test`, `npm run validate:examples`, `npm run build`, and `npm run test:browser` pass: 236 unit/contract tests, six examples and 14 production Chromium cases. Browser coverage includes desktop/light and 360 px/dark, clipboard exactness/fallback, file/drop limits and read races, all fixtures/encoders, keyboard use, reduced motion, back links and strict CSP without browser errors. Browser outputs in `test-results/` are ignored.

A final read-only review found no blocking correctness or security issues. Installing Playwright WebKit was attempted, but both official download hosts (`cdn.playwright.dev` and `playwright.download.prss.microsoft.com`) returned HTTP 403 “Domain forbidden”. WebKit did not run; it would still not replace the real iPhone check.

## Next, in order

1. Check the drop site on a real iPhone in Safari: paste and file selection, Copy AI prompt, timezone picker, every fixture preview, front/back taps and attachment links, light/dark mode and narrow layout. Chromium mobile emulation does not verify Safari. Fix any reproducible issue and rerun affected checks. Delete this handoff once M1 device acceptance is complete.
2. Start M2 from SPEC §5/§12: reuse `layoutPass` data in the pass.json mapping, signing builder, official Wallet badge and navigation POST route. Keep signing secrets server-only, inspect existing settings before requesting credentials, and use real iPhone add/scanning tests.

## Next.js notes

- Read the relevant bundled guides in `node_modules/next/dist/docs/` before changing framework code.
- `src/proxy.ts` supplies nonce CSP in request and response headers; root layout uses `await connection()`. Preview color properties are created only after browser input, so production SSR emits no inline style attributes.
- The native Turbopack raw text rule produced undefined in this version. `scripts/raw-text-loader.cjs` exports the original `.txt` contents at build time. Do not duplicate the prompt into component code or remove the clipboard exactness test.
- The heading font is self-hosted with provenance/license under `src/app/fonts/`; Google Fonts was blocked in this cloud machine.
- Browser tests need a production build first and a free port 3100. Playwright uses `/usr/bin/chromium` if installed or a bundled browser; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select another Chromium. Test fixture imports stay local; no Apple credentials are needed for M1.
