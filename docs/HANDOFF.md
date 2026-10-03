# Handoff: signing backend and native iOS prototype (2026-10-03)

Continue on `milestone-1`. Read `CLAUDE.md`, `docs/SPEC.md`, `docs/DECISIONS.md` and `ios/README.md` first. M1's implementation is complete; real iPhone Safari acceptance is still pending. M2's backend is implemented and the requested native prototype is scaffolded. Genuine Apple Wallet and native device acceptance remain external checks.

## Implemented

- Browser import pipeline and all five previews: recovery warnings, readable validation, authoritative offsets, timezone selection, accessible colors, exact barcodes, shared front/back field layouts, paste/file/drop, Copy AI prompt, privacy page and strict nonce CSP. Boarding departure time is on the front; full departure date/time and zone are on the back.
- Pure `mapToPassJson` shares those layouts, emits exact barcodes and encoding, relevance/expiry, grouping and coordinates. The server signing builder uses UUIDs, passkit-generator 3.6.1 and six reproducible placeholder PNGs. Deployment tracing includes the images.
- Node POST `/api/pass` revalidates browser forms/native JSON and returns an uncached pkpass attachment. Browser downloads use real navigation, never fetch/blob. `/api/import` returns the same normalized values, layouts and warnings for native previews. Both stream-limit the request to 256 KB, reject cross-site browser requests and use a bounded process-local rate guard. No request/pass contents are logged or stored.
- Signing inspection enables the browser Add action; missing/invalid credentials leave previews available. Development builds offer unsigned `pass.json` debugging. `PUBLIC_BASE_URL` allows the configured canonical origin behind a proxy. With `no-referrer`, Chromium form Origin is `null`; it requires `Sec-Fetch-Site: same-origin` rather than accepting arbitrary opaque origins.
- SwiftUI iOS 17+ app, JSON/text import, exact shared prompt resource, native barcode previews, back links, warnings/timezone selection, Apple's `PKAddPassButton`/Wallet sheet and a Share Extension. The app sends previews to the configured HTTPS backend, says so before sending, uses ephemeral networking and refuses redirects. The App Group stores only the server address. Source/project generation/tests are in `ios/`; macOS CI is in `.github/workflows/ios.yml`.

## Verified in the Linux cloud machine

- `npm run typecheck && npm run lint && npm test`: 259 tests in 18 files pass.
- `npm run validate:examples`: six valid fixtures pass.
- `npm run build`: production build passes.
- `npm run test:browser`: all 14 desktop/light and 360 px/dark Chromium cases pass.
- `npm run smoke:signing`: all six native preview/sign requests plus a real browser form download pass using disposable synthetic certificates. The unit package tests independently verify manifest hashes, detached CMS signatures against the synthetic CA, and exported fields/barcodes against the mapping. Library metadata dates serialize to UTC without changing instants; displayed field dates retain their original offsets.

Synthetic certificates are never suitable for real Wallet passes. No real Apple signing variables were available. This Linux machine has no Swift, Xcode or iOS SDK, so native compilation and XCTest results must be obtained from the macOS workflow. Inspect its actual result; do not infer success from the workflow file.

The [macOS CI run for `d1b39da`](https://github.com/noahyao1024/passclip/actions/runs/37100373720) passed: project generation, app/Share Extension build and the simulator XCTest command. This was verified from the run/job's public conclusions, not inferred from the workflow definition. Device acceptance is still pending.

## Remaining steps

1. Keep the macOS workflow passing after native changes. On a Mac generate with `xcodegen generate --spec ios/project.yml --project ios`, then open the Passclip scheme. Use your own bundle IDs/App Group/development team for a physical device; the example IDs are placeholders.
2. Provide genuine Apple signing credentials securely on the server following `.env.example` and SPEC §6; never request values in chat or commit them. Set the canonical HTTPS `PUBLIC_BASE_URL`. Run `npm run check:env`, then verify every fixture adds to Wallet and scans on a real iPhone. Synthetic crypto tests do not establish Apple trust.
3. Check the website on actual iPhone Safari: paste/files, clipboard, timezone picker, every preview, front/back/link taps, light/dark and narrow layout. Also check native import/share, Dynamic Type and VoiceOver.
4. Download Apple's official Add to Apple Wallet badge (this means accepting Apple's license) and put the two SVG files in `public/wallet/` as its README describes; the build switches to the badge automatically. Semantic tags, relevance keys and image sizes were checked against Apple's docs and done (D13, D14).
5. Before hosting for users, add a trusted shared ingress per-IP rate limit. The development guard is process-wide, 30 requests/minute across both routes, and deliberately ignores spoofable forwarding headers; it is insufficient for production multi-instance hosting. Use final pass branding and a release app icon before launch.
6. Milestone 3 (barcode helper) is done (D15); check it on a real iPhone with a real ticket screenshot. Milestone 4 (Add to calendar) is done too (D16); open a calendar file on an iPhone, a Mac and Google Calendar. Next: schema v1.1 for the iOS 27 barcode types (format strings checked in D15). Saved library/accounts and release packaging are not implemented by this prototype.

## Framework/environment notes

- Read relevant Next 16 guides in `node_modules/next/dist/docs/` before changing framework code. `src/proxy.ts` supplies nonce CSP in request/response headers; root layout uses `connection()`.
- Turbopack's native raw text rule produced undefined in this version. `scripts/raw-text-loader.cjs` exports the original prompt. Do not duplicate it into website/app code.
- Font provenance/license is in `src/app/fonts/`. Website preview colors are applied after browser input; production SSR emits no inline style attributes.
- Browser tests need a production build and free port 3100; signing smoke needs free port 3101. Chromium is `/usr/bin/chromium` or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. OpenSSL and python3 are required for the package tests. WebKit downloads were blocked and were not run; Chromium emulation does not replace Safari/device tests.
