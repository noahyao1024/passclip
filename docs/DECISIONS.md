# Decisions

Short entries, newest last. Note what was decided, why, and anything verified in Apple's docs (with the date checked).

## D1: The JSON Schema is the contract
`schema/passclip-import.v1.schema.json` defines the import format. The prompt, examples, TypeScript types and validation all follow it. Changing a field means bumping `schemaVersion`.

## D2: Website first
A web drop site ships faster than an iOS app: no App Store review, and Safari on iPhone can add passes to Wallet directly. The iOS app, Siri and email import come later and reuse the same pass engine.

## D3: Bring your own AI, for now
Users run the extraction in any AI chat with our prompt. Built-in extraction (an API call or Apple's on-device models) can replace that step later without changing the import format.

## D4: Barcodes are never AI-generated
A wrong barcode makes a pass useless at the door. Barcode data comes only from text in the source or a real scan, and the user confirms it.

## D5: Milestone 0 scaffold (2026-10-03)
- `create-next-app` 16.3.8: Next.js 16.3 (App Router, Turbopack), React 19.2, Tailwind 4, ESLint 9. Next.js 16 differs from older versions (`next lint` is gone, `middleware` is now `proxy`, request APIs are async). The `AGENTS.md` that `next dev` maintains points to the docs bundled in `node_modules/next/dist/docs/`, and `CLAUDE.md` imports it.
- TypeScript 5.9, which the template pins. TypeScript 7 works with `next build` but has no compiler API yet, which editor plugins and other tools rely on.
- `npm run typecheck` runs `next typegen` before `tsc`, because Next's route types and `next-env.d.ts` are generated and not committed.
- Vitest 5 runs the tests in Node. Vite resolves the `@/` imports from `tsconfig.json` by itself, so no plugin is needed. Component tests (jsdom) can come with the Milestone 1 UI.
- `@types/node` 22, to match Node 22 and the versions Vitest 5 supports.
- `npm audit` reports 5 high-severity advisories, all from one package (`braces`) inside `eslint-config-next`'s lint tooling. That code never reaches the site, and the suggested fix downgrades `eslint-config-next` to v14, so it stays until Next.js updates its dependency.

## D6: TypeScript types come from the schema, minus rules types can't express
`npm run gen:types` uses json-schema-to-typescript. On its own it turns `if`/`then` into a duplicated intersection type and `maxItems` into lists of tuples, so the script first removes conditional keywords (`allOf`, `anyOf`, `if`/`then`, `dependentRequired` and similar) and keeps arrays plain. The types are slightly looser than the schema (for example, `transit` is optional on every pass type), and Ajv still enforces the whole schema. A test fails when `types.ts` is out of date.

## D7: One module for the signing settings
`src/lib/pass/signing.ts` reads and decodes the signing env vars. `npm run check:env` uses it now, and Milestone 2's pass builder and preview-only mode will too. The check opens the certificate and key with Node's `crypto` module and confirms that the key belongs to the certificate, that the WWDR certificate issued it, and that nothing has expired. Tests create throwaway certificates with OpenSSL, so no certificate is ever committed.

Checked in Apple's docs on 2026-10-03: WWDR G4 is the intermediate certificate for Pass Type ID certificates (Apple Developer Account Help, "WWDR intermediate certificates"). `check:env` doesn't hard-code a generation. It checks that the given WWDR certificate really issued the pass certificate, and if not, names the generation shown in the pass certificate's issuer.

Not confirmed in Apple's docs yet: that the pass certificate's subject holds the pass type ID in `UID` and the team ID in `OU` (the usual layout for Apple's service certificates). `check:env` fails only on a mismatch and adds a note if those fields are missing. Confirm with the real certificate before Milestone 2.

## D8: Browser validation must work under a strict CSP (to do in Milestone 1)
Ajv turns the schema into JavaScript at runtime. A strict Content-Security-Policy (SPEC §11) blocks that in the browser unless it allows `unsafe-eval`. Milestone 1 should precompile the validator with Ajv's standalone code generation (a generated file, like `types.ts`) rather than loosen the CSP. `src/lib/import/validate.ts` compiles at runtime for now, which is fine for scripts and tests.

## D9: The iPhone app comes right after Milestone 2 (2026-10-03)
The owner wants a native app as well as the website. The website still goes first, through Milestone 2, because the app needs the same server to sign passes (the signing key can't ship inside an app) and the website gets real passes working soonest. Then the iOS app starts: its share sheet and on-device extraction are what beat iOS 27's built-in pass creation. M3 to M6 stay, kept small, and are scheduled around the app. App work needs a Mac with Xcode, so it's best done with Claude Code on the owner's Mac.

## D10: Validation runs in the browser, and clean-up is a bit more lenient (Milestone 1, in progress)
- The schema validator is precompiled by `npm run gen:types` (Ajv standalone code with its one runtime helper inlined), which resolves D8. Ajv's own error messages are left out, because `messages.ts` writes plain ones.
- Before validation, Passclip also drops empty values (null, "", {}, []) and attachments without a full https link, with a warning. AI replies often contain empty values, and SPEC §3.3 asks for removing non-https links rather than failing. Passes are never dropped, so pass numbers in messages match the JSON.
- Warnings carry a kind: things Passclip already fixed (`kind: "fix"`) can be shown more quietly than things the user should check.
- Status and next steps: `docs/HANDOFF.md`.

## D11: Milestone 1 drop site and previews (2026-10-03)
- Completed parse → clean → validate → normalize, the ticket-stub drop site, all five front/back previews, local barcodes, AI prompt copying with an optional local email, and the privacy page. `docs/DESIGN.md` records the visual plan. Input is held in browser memory; imports and emails are never sent to the server or stored by the app.
- Luxon gives local timestamps explicit offsets. Missing/invalid zones use the browser zone and a picker. DST gaps shift forward with a check-original warning; overlaps select the earlier instant deterministically and warn with its offset. Impossible dates fail. Historical IANA offsets containing seconds fail with a readable error rather than silently truncating the offset. Explicit timestamps stay unchanged; departure/boarding zone mismatches warn, while arrival offsets can differ legitimately.
- Both text and label colors meet WCAG 4.5:1. Rounded sRGB output is checked when deriving a label color. Front field caps move overflow to the back; long display values remain intact and warn. Field limits are conservative estimates until checked on an iPhone.
- The owner agreed: boarding passes show departure time on the front, and full departure date/time plus zone on the back. Back labels use the supplied IANA zone only if it agrees with the preserved timestamp's actual offset; arrival shows its own offset.
- Field layout is shared pure data in `src/lib/pass/fields.ts` for the preview and M2's future pass builder. Attachments use escaped HTTPS anchors in field data; the preview renders safe React links, never arbitrary HTML. Five type snapshots exercise normalized fixtures.
- Barcodes load bwip-js on demand and use the original message with parsing disabled. Latin-1 and UTF-8 match the planned pass encoding. Ready appears after the locally generated image loads; encoding failures show a fixed message without logging the ticket. Code 128 warns about Apple Watch. Screenshot decoding, signing and calendar downloads remain later milestones; their unavailable state is explicit.
- Read the bundled Next 16.3.8 docs before implementation. `src/proxy.ts` creates a per-request CSP nonce; `connection()` makes documents dynamic. Production has neither unsafe-eval nor unsafe-inline, and development relaxations stay in development. HTTPS alone enables upgrade-insecure-requests. Referrer policy is no-referrer, content sniffing is disabled, and the framework identity header is disabled.
- Installed Turbopack's native `type: "raw"` compiled the prompt import as undefined. A tiny local synchronous text loader now exports the source file at build time; browser tests verify clipboard content byte-for-byte. Google Fonts returned a verified-TLS proxy 403, so licensed Schibsted Grotesk is self-hosted from the Fontsource npm package with provenance and OFL license.
- Validation: typecheck, lint, 236 unit/contract tests, six example validations, production build and 14 production Chromium checks pass. Browser checks cover every fixture, all four encoders, file limits/drop/read cancellation, clipboard and fallback, timezone selection, syntax-location focus, both flip directions with working back links, long text, reduced motion, keyboard operation, light/dark mode and 360 px width. No production CSP violations or browser errors were observed. Real iPhone Safari remains an external device check before declaring the milestone's device acceptance complete.

## D12: M2 backend and native iOS prototype (2026-10-03)
- Added pure `mapToPassJson`, six mapping snapshots, UUID serial numbers, exact barcode encoding, expiry/relevance and coordinates, and a passkit-generator 3.6.1 signing builder reusing the preview fields. Relevance intervals longer than 24 hours use the legacy relevantDate rather than emitting an unsupported interval. Placeholder icon/logo variants are reproducibly generated and included in Next deployment tracing.
- `/api/pass` accepts browser navigation POST forms and native JSON, enforces the body size while reading the stream, runs the shared validation/normalization pipeline, and returns an uncached pkpass attachment. `/api/import` returns the same normalized values and layouts for native previews. Neither endpoint logs or stores ticket content. Invalid/missing signing configuration returns 503 without exposing keys or internal errors.
- The browser's Add action becomes a real form when certificate inspection succeeds. Preview-only behavior remains when signing is absent; unsigned pass.json is downloadable only in development. PUBLIC_BASE_URL is an allowed canonical browser origin because Next may construct an internal URL behind a proxy. Arbitrary caller forwarding headers do not establish a trusted origin. With the required no-referrer policy, Chromium sends Origin: null for a form POST; that is accepted only with browser-controlled Sec-Fetch-Site: same-origin. Cross-site and unsupported opaque origins fail.
- A process-local 30/minute guard limits both endpoints; production multi-instance deployment must enforce a shared per-IP limit at a trusted ingress. This development guard deliberately does not trust spoofable forwarding headers.
- Added a SwiftUI app, local Core Image barcode previews, time-zone selection, Apple's PKAddPassButton and PKAddPassesViewController, a Share Extension, a XcodeGen project specification, and XCTest sources. The app requires a configured HTTPS server and uses ephemeral networking. Shared storage contains only the server address; pass content remains in memory. Native previews send imports to the server, unlike browser previews, and this is stated in the interface and privacy page.
- This Linux machine has neither Swift/Xcode nor iOS SDKs. The [macOS GitHub Actions run for `d1b39da`](https://github.com/noahyao1024/passclip/actions/runs/37100373720) successfully generated the Xcode project, built the app/Share Extension and completed simulator XCTest. Public run/job conclusions were inspected; physical-device results remain pending.
- Current Apple documentation and badge artwork are blocked (developer.apple.com, docs-assets.developer.apple.com), and GitHub Actions API reads are blocked (api.github.com). Recommended semantic tags and final website badge artwork are deferred until the official sources can be checked; no badge was redrawn. Native UI uses Apple's SDK-provided control. Actual Apple signing credentials are absent, so synthetic certificates validate packaging/cryptography only, not iPhone Wallet acceptance.
- Verified typecheck, lint, 259 unit/contract tests, six example imports, production build, 14 Chromium cases and the production signing smoke (six native preview/sign requests and one browser form download). Package tests verify every manifest hash and detached CMS signature against the temporary CA, and compare the exported pass fields/barcodes to the pure mapping. The library normalizes only relevance/expiry metadata to equivalent UTC instants and adds an empty enhanced event row.
