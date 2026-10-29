# App Store release tools

Run these commands from the repository root after `npm ci` (Node 22 or later).
`asc-release.mjs` manages Passclip's iOS app record, one explicit version at a time.
Keep the existing `ASC_KEY_ID` and `ASC_ISSUER_ID` environment settings and the private
key at `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`. Credentials stay outside
the repository. The tools do not print the key, JWT, or signed upload URLs.

## Prepare and submit a version

```sh
node scripts/app-store/asc-release.mjs status
node scripts/app-store/asc-release.mjs create 1.2
node scripts/app-store/asc-release.mjs check scripts/app-store/metadata/en-US.json
node scripts/app-store/asc-release.mjs metadata 1.2 scripts/app-store/metadata/en-US.json
node scripts/app-store/asc-release.mjs whatsnew 1.2 scripts/app-store/whats-new/1.2
node scripts/app-store/asc-release.mjs build 1.2 <processed-build-number>
node scripts/app-store/asc-release.mjs review 1.2
node scripts/app-store/asc-release.mjs submit 1.2
```

`create` finds an existing version or creates one with automatic release after approval.
`check` only checks a local metadata file. `metadata` checks that file before updating
its locale, adding the locale when needed and copying missing links from the primary
language. `whatsnew` accepts a shared text file or a folder of `<locale>.txt` files.
`build` requires a processed (`VALID`) build. `review` copies the live version's App
Review contact and notes into the requested version.

`submit` reuses a `READY_FOR_REVIEW` draft that already contains the requested version,
or an empty draft, before creating a new submission. It skips adding an item that is
already present. Ambiguous drafts, drafts for another version, and drafts containing
other review items require resolution in App Store Connect before the tool proceeds.

```sh
node scripts/app-store/asc-release.mjs cancel 1.2
node scripts/app-store/asc-release.mjs status
```

`cancel` requests cancellation of the active submission whose item refers to **1.2**.
It refuses a submission with additional items because cancelling it would also affect
those items. Cancellation is asynchronous; `status` shows the version's resulting
state. A released version cannot be withdrawn with this command.

## Replace screenshots

The existing framer takes a folder of simulator PNGs and a `captions.json` array of
`{ "file": "1-home.png", "caption": "Your caption" }` objects:

```sh
npx tsx scripts/app-store/frame-screenshots.ts /path/to/screenshots
node scripts/app-store/asc-release.mjs screenshots 1.2 /path/to/screenshots/framed
# A different localization must already exist on that version:
node scripts/app-store/asc-release.mjs screenshots 1.2 /path/to/spanish/framed es-MX
```

The default locale is `en-US`. The uploader accepts these two ordinary screenshot
targets; Duo preparation and its upload route are separate work.

| Filename prefix | API display target | Accepted portrait sizes (also accepts landscape) |
| --- | --- | --- |
| `iphone-` | `APP_IPHONE_67` | 1260 × 2736, 1290 × 2796, 1320 × 2868 |
| `ipad-` | `APP_IPAD_PRO_3GEN_129` | 2048 × 2732, 2064 × 2752 |

Files may be `.jpg`, `.jpeg`, or `.png`. They are uploaded in filename order with
numeric sorting (`iphone-2` before `iphone-10`). Supply 1–10 images per target.
Only targets present in the folder are replaced; other screenshot sets and locales
are left alone. Unknown image prefixes and empty folders fail.

Before any API request, the uploader reads every input into memory, checks file
types, PNG decoding/CRC and absence of alpha/transparency, JPEG headers and end
markers, dimensions, and counts. It resolves the requested version and locale and
reads all affected sets before deleting old screenshots. A version must be editable
(`PREPARE_FOR_SUBMISSION`, `DEVELOPER_REJECTED`, `REJECTED`, or `METADATA_REJECTED`).

For each image it reserves an asset, sends the exact byte ranges and headers Apple
provides, commits the whole-file MD5 checksum, and waits for `COMPLETE`. An HTTP or
network failure, `FAILED` processing, or a processing timeout exits with failure.
Each binary request has a 60-second timeout; processing is checked up to 60 times
at two-second intervals. Apple still performs the final asset validation.

Replacement is not transactional: a remote failure after deletion can leave a
partially replaced set. Keep the source images and inspect App Store Connect before
retrying. The tool never submits the version as part of screenshot replacement.

The API sequence follows Apple's [asset upload workflow](https://developer.apple.com/documentation/appstoreconnectapi/uploading-assets-to-app-store-connect),
[review submission API](https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-reviewsubmissions-_id_),
and [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
(checked 2026-10-29). This preserves the existing `appScreenshots` route; it does not
migrate to Apple's newer Asset Library workflow.

## Verify without App Store access

```sh
npx vitest run scripts/app-store/asc-release.test.ts
npm run typecheck && npm run lint && npm test
```

The release tests mock the authenticated API helper and binary uploads. They use
temporary synthetic images, exercise request order and failure paths, and require
no credentials or live release changes.
