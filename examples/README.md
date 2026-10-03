# Examples and test fixtures

## Valid (`examples/*.json`)
Every file here must pass schema validation as-is (`npm run validate:examples` checks only this top-level folder).

| File | What it covers |
|---|---|
| `event-tickets.json` | Two tickets from one order (same confirmation code, so they group in Wallet), seats, price, QR barcode, notes, an attachment |
| `flight.json` | Boarding pass: air, terminals, gate, boarding group and time, PDF417 barcode, arrival in a different time zone |
| `train-local-time.json` | Boarding pass: train, times **without** UTC offset plus `timeZone`, no barcode (the UI should offer the barcode helper), AI warnings |
| `loyalty-card.json` | Store card with points, Code 128 barcode (preview should warn it won't show on Apple Watch), custom colors |
| `coupon.json` | Coupon with promo code, date-only `expires` (normalizes to 23:59:59 local that day), no barcode |
| `gym-membership.json` | Generic pass with membership, `extraFields`, attachment |
| `grocery-card.json` | Schema 1.1: store card with an EAN-13 barcode (needs iOS 27 in Wallet; preview warns), a balance, and only a background color |

## Recoverable (`examples/recoverable/`)
Not valid as-is. The lenient parser must recover each one **and show a warning for every fix**.

| File | Expected fixes |
|---|---|
| `fenced-with-prose.txt` | Take the JSON out of the ```json fence; ignore the text around it |
| `single-pass-root.json` | Root is a single pass: wrap it as `{ "schemaVersion": "1.0", "passes": [ ... ] }` |
| `curly-quotes.txt` | Replace curly double quotes with straight ones, then parse |
| `trailing-comma-no-version.txt` | Remove trailing commas; add missing `schemaVersion` |
| `unknown-keys.json` | Remove `eventDate`, `color` and `venue.parking`; warn about each |

## Invalid (`examples/invalid/`)
Must fail validation with plain, specific messages.

| File | Expected message (wording can vary) |
|---|---|
| `missing-title.json` | Pass 1 needs a title, for example the event name. |
| `bad-date-and-color.json` | Pass 1: start must look like 2026-11-14T19:30:00+09:00. Pass 1: background color must be a hex color like #2D1E4A. |
| `boarding-pass-without-transit.json` | Pass 1 is a boarding pass, so it needs travel details (transit with mode, from and to). |
