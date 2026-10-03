# Passclip: Phase 1 spec (web drop site)

Working name: Passclip. Spec version 0.1, October 2026.

## 1. What we're building

Passclip turns tickets, bookings, memberships and coupons into Apple Wallet passes, with notes and files clipped to them.

Phase 1 is a website, the **drop site**:

1. The user copies Passclip's AI prompt.
2. They paste it, plus their email or ticket, into any AI chat (Claude, ChatGPT, Gemini and so on). The AI replies with Passclip Import JSON.
3. They paste or drop that JSON on the site, check a live preview, and tap **Add to Apple Wallet** (and **Add to calendar**).

Why start here: the pass engine (parse → validate → normalize → map → sign) is the core of every later feature. Email import, the iOS app, Siri and on-device AI will all produce the same import JSON and reuse this engine.

Positioning: iOS 27's Wallet can create simple passes by itself (scan a QR code or type details in). Passclip has to beat that on:

- zero typing: every detail comes from the source (seat, gate, confirmation code, times),
- attachments and notes on the back of the pass,
- calendar events,
- later: email forwarding, Siri and automatic extraction.

## 2. Scope

In Phase 1:

- Drop zone: paste text, drop a `.json` or `.txt` file, or choose a file.
- Lenient parsing, schema validation, friendly errors and warnings.
- Normalization (time zones, colors, defaults).
- Live preview of each pass, front and back.
- Signed `.pkpass` generation and Add to Apple Wallet.
- Barcode helper: decode a screenshot of a QR code or barcode in the browser.
- Add to calendar (`.ics`).
- Attachments: links from the JSON (M2), file uploads (M5).
- Copy AI prompt button, privacy page.

Not in Phase 1: accounts, a saved pass library, pass updates and push (`webServiceURL`), email import, the iOS app, Siri, built-in AI extraction, localization, NFC passes, the iOS 18 poster event ticket layout, Apple Pay.

## 3. Import format

Source of truth: `schema/passclip-import.v1.schema.json` (JSON Schema 2020-12). It already compiles in Ajv's strictest mode.

```
{ schemaVersion: "1.1", source?: Source, passes: Pass[], warnings?: string[] }   // "1.0" files are read too
```

Pass types mirror Apple's pass styles: `eventTicket`, `boardingPass`, `storeCard`, `coupon`, `generic`. Only `type` and `title` are required. Boarding passes also need `transit` (with `mode`, `from` and `to`). Field meanings are in the schema's `description`s.

### 3.1 Lenient parsing (`src/lib/import/parse.ts`)

Run these steps in order and record a warning for every fix:

1. Trim the text and remove a byte-order mark.
2. If it contains a fenced code block (```` ```json ```` or ```` ``` ````), use the first block's contents.
3. Otherwise, if there's prose around the JSON, take the first balanced top-level `{…}` or `[…]` (count braces outside strings only; respect escapes).
4. `JSON.parse`. If that fails, replace curly double quotes (“ ”) with straight ones and remove trailing commas before `}` or `]`, then try again. If it still fails, show the parse error with line, column and a short snippet.
5. Fix the root: a single pass object (has `type` and `title`) or an array of passes gets wrapped as `{ "schemaVersion": "1.0", "passes": [...] }`. A missing `schemaVersion` gets `"1.0"`.

Fixtures: `examples/recoverable/` (expected fixes in `examples/README.md`).

### 3.2 Validation (`src/lib/import/validate.ts`)

- Use Ajv's 2020 build (`ajv/dist/2020`) with `allErrors: true`. Compile the schema once.
- Unknown keys are removed with a warning, not rejected. Run validation once without removal to collect `additionalProperties` errors (their `params.additionalProperty` gives the key) and turn them into warnings with the path. Then validate a clone with `removeAdditional: true` to get the real errors.
- Turn Ajv errors into plain messages with the pass number and field. For example:
  - "Pass 1 needs a title, for example the event name."
  - "Pass 2: start must look like 2026-11-14T19:30:00+09:00."
  - "Pass 1: background color must be a hex color like #2D1E4A."
  - "Pass 1 is a boarding pass, so it needs travel details (transit with mode, from and to)."
- Limits: 256 KB of input, 20 passes (in the schema).
- `"passes": []` is valid. Show an empty state ("No passes found") with the AI's warnings.

Fixtures: `examples/invalid/` (each must fail with readable messages).

### 3.3 Normalization (`src/lib/import/normalize.ts`)

The normalized object, not the raw import, is what the preview, the pass builder and the calendar file use.

- **Times without an offset:** compute the offset from `timeZone` using Luxon (handle daylight-saving gaps and overlaps). With no `timeZone`, ask the user to pick one (default: the browser's time zone) and show a warning.
- **Impossible dates** (like 2026-13-40) fail with a readable error.
- **Date-only values:** `expires` becomes 23:59:59 local time on that date (in `timeZone`, or the user's time zone). `since` is display only.
- **Text:** trim, collapse repeated spaces, strip control characters. Text over display limits stays, with a warning, because Wallet truncates long values.
- **Colors:** if only `backgroundColor` is set, pick white or black foreground, whichever has more contrast, and derive `labelColor` between foreground and background. With no `style`, use the type defaults in §4.5. Foreground-to-background contrast must be at least 4.5:1; if not, fix it and warn.
- **Attachments:** https only. Others are removed with a warning.
- **Barcodes:** never change the message. Code 128 gets a preview warning: Apple Watch can't display it. EAN-13, Code 39, Codabar and ITF get one too: Wallet shows them on iOS 27 and later.

## 4. Mapping to pass.json (`src/lib/pass/`)

Write pure functions such as `mapToPassJson(pass: NormalizedPass, config: PassConfig): PassJson`, with unit tests and a snapshot test per type. passkit-generator only packages and signs.

### 4.1 Top-level keys (all types)

| pass.json key | Value |
|---|---|
| `formatVersion` | `1` |
| `passTypeIdentifier`, `teamIdentifier` | from env |
| `serialNumber` | new UUID v4 |
| `organizationName` | `organization ?? title` |
| `description` | `description` ?? generated: "Event ticket for {title}", "Boarding pass from {from} to {to}", "Loyalty card for {title}", "Coupon from {organization ?? title}", "Pass for {title}" |
| `logoText` | `organization ?? title` |
| `backgroundColor`, `foregroundColor`, `labelColor` | `"rgb(r, g, b)"` strings from the normalized style |
| `barcodes` | `[{ format, message, messageEncoding, altText }]`. Formats: qr → `PKBarcodeFormatQR`, pdf417 → `PKBarcodeFormatPDF417`, aztec → `PKBarcodeFormatAztec`, code128 → `PKBarcodeFormatCode128`, ean13 → `PKBarcodeFormatEAN13`, code39 → `PKBarcodeFormatCode39`, codabar → `PKBarcodeFormatCodabar`, itf → `PKBarcodeFormatI2of5` (the last four need iOS 27). `messageEncoding`: `"iso-8859-1"`, or `"utf-8"` if the message has characters outside Latin-1 |
| `relevantDates` | relevance window (§4.3), iOS 18+ |
| `relevantDate` | `start`. Deprecated since iOS 18, but keeps iOS 17 and earlier working |
| `expirationDate` | `expires`. For eventTicket and boardingPass without `expires`: `(end ?? start)` + 6 hours |
| `locations` | from `venue` or `transit.from` coordinates when present: `[{ latitude, longitude, relevantText }]` |
| `groupingIdentifier` | `confirmationCode` (eventTicket and boardingPass only), so tickets from one order stack together |
| `semantics` | §4.6 |

### 4.2 Fields by type

Field caps keep layouts clean; anything over goes to the back: header ≤ 2, primary 1 (boarding pass: 2), secondary ≤ 3, auxiliary ≤ 4.

Date and time fields: the value is the ISO string; set `dateStyle` / `timeStyle` and `ignoresTimeZone: true`, so the event's local time shows wherever the viewer is.

**eventTicket**
- header: date (short date)
- primary: title (label: `subtitle ?? "Event"`)
- secondary: starts (medium date + short time), venue name
- auxiliary: section, row, seat number, entrance; then `extraFields` until full

**boardingPass**
- `transitType`: air → `PKTransitTypeAir`, train → `PKTransitTypeTrain`, bus → `PKTransitTypeBus`, boat → `PKTransitTypeBoat`, other → `PKTransitTypeGeneric`
- header: gate (or platform for trains)
- primary: from (label `from.city ?? from.name`, value `from.code ?? from.name`) and to (same pattern)
- secondary: passenger (`holderName`), departs (short time)
- auxiliary: number (label "Flight", "Train", "Bus", "Boat" or "Service"), seat, group, boarding (time only), cabin, car

**storeCard**
- primary: points ("Points") or balance ("Balance", using the field's `currencyCode`); otherwise `holderName`
- secondary: member (`holderName`), member ID
- auxiliary: tier, expires

**coupon**
- primary: `offer.headline ?? title` (label: `organization ?? "Offer"`)
- secondary: expires (medium date)
- auxiliary: `offer.code` ("Code")
- back: `offer.terms` ("Terms")

**generic**
- header: expires, if present
- primary: title (label: `subtitle` or empty)
- secondary: name (`holderName`), member ID
- auxiliary: tier, start (if any), then `extraFields`

### 4.3 Relevance

- `relevantDates`: one window `{ startDate, endDate }`.
  - eventTicket: start − 3 h → `end ?? start + 3 h`.
  - boardingPass: `(boardingTime ?? start)` − 3 h → start + 1 h.
  - Other types: none.
- Check the key names and lock-screen behavior on a real device (§14).

### 4.4 Back fields (in this order; skip empty ones)

1. `notes` ("Notes")
2. attachments, one field each: label = title, value = URL, `attributedValue` = `<a href="URL">Open</a>`. That anchor is the only HTML allowed; escape everything else.
3. holder name, confirmation code ("Confirmation"), ticket number ("Ticket number"), price (with `currencyCode`)
4. venue name, address and room; for boarding passes, from/to names, terminals and arrival time (`end`)
5. `extraFields` that didn't fit on the front
6. source: "Imported from {subject}" (and sender) when present
7. "Made with Passclip" and `PUBLIC_BASE_URL`

Keys must be unique within a pass (for example `att_1`, `x_1`).

### 4.5 Default pass colors (when `style` is missing)

| Type | Background | Foreground | Label |
|---|---|---|---|
| eventTicket | #2D1E4A | #FFFFFF | #CDBEF0 |
| boardingPass | #0F2C4C | #FFFFFF | #B9D3F0 |
| storeCard | #1F4D3A | #FFFFFF | #BFE3CF |
| coupon | #8C2F39 | #FFFFFF | #F4C7CC |
| generic | #2F3640 | #FFFFFF | #C9D1DC |

### 4.6 Semantic tags (recommended)

Semantic tags help iOS understand the pass (suggestions, event and travel features). Add what we have, after checking exact key names and value shapes in Apple's semantic tags docs (§14):

- eventTicket: `eventName`, `venueName`, `venueLocation`, `eventStartDate`, `eventEndDate`, `seats`, `confirmationNumber`, `totalPrice`
- boardingPass (air): `airlineCode`, `flightCode`, `flightNumber`, `departureAirportCode`, `departureAirportName`, `destinationAirportCode`, `destinationAirportName`, `departureGate`, `departureTerminal`, `destinationTerminal`, `originalDepartureDate`, `originalArrivalDate`, `originalBoardingDate`, `boardingGroup`, `seats`, `confirmationNumber`, `transitProvider`
- boardingPass (train, bus, boat): `departureStationName`, `destinationStationName`, `departurePlatform`, `transitProvider`, `vehicleNumber`, `carNumber`, `seats`

## 5. Making the .pkpass

Files: `src/lib/pass/build.ts`, `src/app/api/pass/route.ts`.

- Use **passkit-generator** (v3.5 or later, MIT): load the model folder `pass-models/default.pass/`, apply the mapped pass.json values, barcodes, fields and semantics, sign with the certificates from env, and return the buffer.
- The route runs on the Node.js runtime (`export const runtime = "nodejs"`), never Edge.
- Response headers: `Content-Type: application/vnd.apple.pkpass`, `Content-Disposition: attachment; filename="<slug>.pkpass"`, `Cache-Control: no-store`.
- The route re-validates its input on the server. Never trust the client.
- Model images: `icon.png` (+ `@2x`, `@3x`) is required; `logo.png` (+ `@2x`, `@3x`) is recommended. In M2, a script makes simple placeholder art (a paper clip mark); real brand art comes later. Take exact pixel sizes from Apple's current pass design docs.
- **Preview-only mode:** if any signing env var is missing, the site still previews passes, the Add button is disabled with "Pass signing isn't set up yet", and development builds offer "Download pass.json" for debugging.

### 5.1 Getting the pass onto an iPhone

- iOS Safari shows the Add to Apple Wallet sheet when the user navigates to a response with the pkpass content type. Use a real navigation: an HTML form that POSTs the normalized pass JSON (hidden field, `target="_self"`) to `/api/pass`. Don't use `fetch` plus blob URLs for this.
- If testing shows any iOS version misbehaving with the POST response, fall back to: POST returns 303 to a short-lived, one-time GET URL. Only build this if needed.
- Desktop: the file downloads. Show: "Send this file to your iPhone (AirDrop, Messages or email) and tap it there to add it."
- Several passes: one Add button per pass in M2. Stretch goal: a single `.pkpasses` bundle (`application/vnd.apple.pkpasses`, iOS 15+; check Apple's limits).
- Use Apple's official "Add to Apple Wallet" badge artwork and follow Apple's badge guidelines. Don't redraw it.

## 6. Signing setup

The owner does steps 1 to 3 in the Apple Developer website and Keychain Access on a Mac.

1. Join the Apple Developer Program (paid membership).
2. Certificates, Identifiers & Profiles → Identifiers → Pass Type IDs: create one, like `pass.com.yourdomain.passclip`. Create its certificate (upload a certificate signing request made in Keychain Access), download it and open it so it's added to Keychain.
3. In Keychain Access, export the certificate together with its private key as a `.p12` file with a password.
4. Convert to PEM files (OpenSSL 3 may need `-legacy`):
   - `openssl pkcs12 -in pass.p12 -clcerts -nokeys -out signerCert.pem`
   - `openssl pkcs12 -in pass.p12 -nocerts -out signerKey.pem` (choose a passphrase)
   - Download Apple's WWDR intermediate certificate (the current generation; check Apple's certificate authority page) and convert it: `openssl x509 -inform der -in AppleWWDRCA.cer -out wwdr.pem`
5. Base64-encode each PEM file and put the values in `.env.local` (names in `.env.example`). Never commit them. Add the same values as encrypted env vars at the hosting provider.
6. `npm run check:env` checks that everything is present and that the certificate matches `PASS_TYPE_IDENTIFIER` and `APPLE_TEAM_ID`.

## 7. Barcode helper (M3, browser only)

- Drop or choose an image (screenshot or photo) and decode it in the browser with ZXing (`@zxing/library`, D15). Formats: QR, PDF417, Aztec, Code 128, and from schema v1.1 EAN-13, Code 39, Codabar and ITF.
- Show the decoded text and format. The user taps **Use this code** to accept it. If several codes are found, list them all.
- If the JSON already has a different barcode, show both and make the user choose.
- Manual entry is allowed, with a warning that one typo makes the pass unusable at the door.
- Images never leave the device.
- iOS 27 adds EAN-13, Code 39, Codabar and ITF barcodes to Wallet. Schema v1.1 adds them, with format strings checked in Apple's docs (D15, D17).

## 8. Add to calendar (M4)

- Offered for passes with `start` (on by default for eventTicket and boardingPass; `calendar.add` overrides).
- Generate an `.ics` file (RFC 5545): `VCALENDAR` with `PRODID` and `VERSION:2.0`; one `VEVENT` with `UID` (`serialNumber@host`), `DTSTAMP`, `DTSTART` / `DTEND` in UTC, `SUMMARY` (`calendar.title ?? title`; boarding passes like "ZQ 101 Tokyo → Paris"), `LOCATION` (venue name and address, or from → to), `DESCRIPTION` (seat, confirmation code, notes, attachment links) and `VALARM`s.
- Default end: events start + 2 h; travel `end ?? start + 1 h`.
- Alerts: `calendar.alertMinutesBefore`, otherwise events 120 min, flights 180 min, trains, buses and boats 30 min.
- Escape commas, semicolons, backslashes and newlines; fold lines at 75 octets; use CRLF. Keep it a small tested helper in `src/lib/calendar/ics.ts`.
- Serve with `Content-Type: text/calendar; charset=utf-8` through a real navigation, like passes.

## 9. Attachments (M5)

- Links from the JSON already appear on the back of the pass (§4.4).
- Uploads: PDF, JPEG, PNG or HEIC, up to 10 MB each and 5 per pass. Store them in object storage (Supabase Storage or any S3-compatible bucket) under long random paths, served over https.
- Anyone who has the pass can open these links. Say so next to the upload control.
- After upload, show a delete link once.
- Never put attachment files inside the `.pkpass`.
- Built (D19): the browser uploads straight to the bucket with a short-lived signed link from `/api/attachments` (Vercel Functions accept at most 4.5 MB). Nothing about an upload is stored; the delete link carries a secret after `#`, and `/delete-file` deletes the file when the person confirms. Uploads stay off until the `STORAGE_*` settings are set.

## 10. UI and design direction

### Pages

- `/`: the drop site. Everything happens here.
- `/privacy`: what's processed and what's stored.

### Flow on `/`

1. Hero: one line, "Turn any ticket into an Apple Wallet pass.", with the drop zone right under it. The drop zone takes paste (a textarea), drag and drop, and a **Choose file** button, and works with a keyboard.
2. **Copy AI prompt** next to the drop zone, with: "Paste it into any AI chat with your ticket email, then paste the reply here." Privacy note under it: "Your email goes to the AI service you choose. Remove anything you don't want to share."
3. Optional helper: a "Your ticket email" box. If filled, **Copy AI prompt** copies the prompt with the email added at the end, so the user pastes once. This text stays in the browser.
4. How it works, as three numbered steps (it is a real sequence): copy the prompt, ask any AI, drop the reply here.
5. Results: one card per pass with the preview (tap to flip front and back), warnings, barcode status ("Barcode ready" or "No barcode yet: add a screenshot") and the actions **Add to Apple Wallet** and **Add to calendar**.
6. Errors say what's wrong and how to fix it, and keep the user's input so they can edit it in place.

### Preview

- Mirror Wallet's layout for each type at real proportions, using the system font stack (`-apple-system, system-ui`) so it looks like Wallet. Small uppercase field labels belong here because Wallet uses them; don't use all-caps labels anywhere else on the site.
- Render barcodes in the preview with `bwip-js` and show `altText` under them.

### Look and feel

A starting point. Write a short design plan (palette, type, layout, the one memorable element) and check it against this section before building the UI.

- Subject matter: ticket counters, ticket stubs, paper clips. Avoid generic looks: identical rounded cards everywhere, gradient washes, cream with terracotta, black with neon.
- Palette: Paper `#E9EDF2` (page), White `#FFFFFF` (surfaces), Ink `#1A2230` (text), Steel `#8B96A8` (clip, perforation, borders), Signal `#3346D3` (main actions), Stub `#F2B33D` (drag-over and attachment accents), Error `#B3261E`.
- Type: one display face with character for headings (for example Schibsted Grotesk from Google Fonts); the system UI font for body text and the pass preview.
- The one memorable element: the drop zone looks like a ticket stub with a perforated edge and a paper clip, and when JSON lands, the passes slide out of it once. Respect `prefers-reduced-motion`. Keep everything else quiet.
- Quality floor: works from 360 px wide, visible keyboard focus, WCAG AA contrast, dark mode via `prefers-color-scheme`.

### Copy rules

Sentence case, plain verbs, active voice. Buttons say exactly what happens: "Copy AI prompt", "Add to Apple Wallet", "Add to calendar", "Use this code". Errors never apologize and are never vague.

## 11. Security and privacy

- No accounts and no stored pass data in M0 to M4: the server builds the pass and forgets it.
- Never log request bodies, pass JSON, names or barcodes. Scrub error reports.
- Limits: 256 KB request body, 20 passes per import, rate-limit pass and calendar generation (for example 30 per minute per IP).
- Re-validate everything on the server. Allow https attachment URLs only. Escape all text placed in `attributedValue`.
- Security headers: a strict Content-Security-Policy, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
- No third-party trackers in Phase 1.
- The privacy page says what the site processes, that nothing is stored (until M5 uploads), and that the AI step happens in the user's own AI tool.

## 12. Milestones

Work in order. Each milestone ends with tests passing and a short entry in `docs/DECISIONS.md`.

**M0: Scaffold and contract**
- Next.js (App Router, TypeScript strict, Tailwind, ESLint) and Vitest. `create-next-app` refuses non-empty folders, so scaffold into a temporary folder and move the files in without overwriting existing ones.
- npm scripts: `dev`, `build`, `test`, `lint`, `typecheck`, `validate:examples`, `gen:types`, `check:env`.
- `gen:types`: TypeScript types from the schema (json-schema-to-typescript; hand-write them if it struggles with 2020-12 features).
- Done when every `examples/*.json` validates, every `examples/invalid/*` fails, and all scripts run.

**M1: Drop site without signing**
- Drop zone, lenient parser, validation messages, normalization, warnings, previews for all five types, Copy AI prompt (copies `prompts/extract-to-passclip.txt` verbatim, loaded at build time; never duplicate the prompt in code), privacy page.
- Done when every valid example previews correctly, every recoverable fixture is recovered with warnings, every invalid fixture shows readable errors, and it all works in iPhone Safari.

**M2: Real Wallet passes**
- Mapping functions with snapshot tests, placeholder images, `/api/pass` with passkit-generator, preview-only mode, the Add to Apple Wallet button.
- Done when every valid example adds to Wallet on a real iPhone, fields and colors match the preview, and barcodes scan with another phone.

**After M2: start the iOS app** (§15, decision D9). It signs passes through the M2 server. M3 to M6 stay in the plan, kept small, and are scheduled around the app.

**M3: Barcode helper**
- Done when sample QR, PDF417, Aztec and Code 128 images decode in Safari and Chrome, and nothing is uploaded.

**M4: Add to calendar**
- Done when the `.ics` files import into Apple Calendar (iPhone and Mac) and Google Calendar with the right local times and alerts.

**M5: Attachments**
- Done when uploaded files open from the back of the pass on iPhone, paths are unguessable, and delete links work.

**M6: Launch**
- Deploy (for example Vercel, with API routes on the Node.js runtime), custom domain, env vars, real icon and logo, final privacy page.

## 13. Testing

- Unit: parser recovery, Ajv message mapping, time zone normalization (including daylight-saving changes), color contrast, mapping per type (snapshots), `.ics` escaping, folding and UTC conversion.
- Contract: every `examples/*.json` parses, validates, normalizes and maps without errors.
- Device checklist (M2 onward): add each example on an iPhone; check front and back fields, links, barcode scanning, lock-screen relevance near the start time, dark mode, and Apple Watch (Code 128 won't show there).

## 14. Check Apple's docs before relying on these

- `relevantDates` key names and behavior on iOS 27 (the single `relevantDate` is deprecated since iOS 18).
- Semantic tag names and value shapes (§4.6).
- Exact pass.json format strings for iOS 27's new barcode types (EAN-13, Code 39, Codabar, ITF).
- Current pass image sizes, field limits and `.pkpasses` limits.
- Which WWDR certificate generation to use.
- "Add to Apple Wallet" badge guidelines.
- Helpful tool: Apple's Pass Designer app for Mac (announced at WWDC 2026) for previewing pass designs.

## 15. Later phases (don't build yet; keep the design ready for them)

- **Email:** a personal forwarding address (an inbound-email service → extraction → passes). Optional Gmail or Outlook connection later; Gmail read access needs Google's app verification and a security assessment.
- **iOS app (SwiftUI), next after M2:** PassKit add flow, a Share Extension (selected text, PDFs and images from Mail, Safari and Photos), EventKit calendar events, widgets. Passes are still signed on the server: the signing key never ships inside the app.
- **Siri and Apple Intelligence:** from iOS 27, App Intents is the only way Siri reaches third-party apps (SiriKit is deprecated). Planned intents: "Add this ticket to Passclip", "Show my next pass", "What's attached to my flight?". Model passes as App Entities so Siri and Spotlight can find them.
- **On-device extraction:** Apple's Foundation Models framework with a `@Generable` Swift type that mirrors this schema, replacing the copy-and-paste AI step.
- **Pass updates:** `webServiceURL` and push notifications to update gates and times.
- **Accounts and sync** (for example Supabase Auth and Postgres), a pass library, sharing.
