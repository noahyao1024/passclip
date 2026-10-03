# Passclip

Passclip turns tickets, bookings, memberships and coupons into Apple Wallet passes. Paste the JSON from any AI chat and check all five pass styles in a live preview. The signing backend enables Wallet downloads when configured with Apple certificates, and a native iOS prototype is available under `ios/`.

## What's inside

- `CLAUDE.md`: instructions Claude Code reads automatically when it starts in this folder
- `docs/SPEC.md`: the full spec and milestones
- `docs/DECISIONS.md`: a log Claude Code keeps as it builds
- `schema/passclip-import.v1.schema.json`: the import format
- `prompts/extract-to-passclip.txt`: the prompt people paste into any AI chat
- `examples/`: sample imports for testing (valid, recoverable and invalid)
- `src/`: the website (Next.js)
- `scripts/`: the checks and generators behind the npm commands
- `.env.example`: the settings you'll fill in for pass signing

## Run it locally

You need Node.js 20.9 or later.

```
npm ci
npm run dev
```

Then open http://localhost:3000. `CLAUDE.md` lists every command.

Imports and the optional ticket email stay in browser memory. No Apple credentials are needed for previews. Use **Try an example** to see the flow, or choose a file from `examples/`.

## Check changes

```
npm run typecheck && npm run lint && npm test
npm run validate:examples
npm run build
npm run test:browser
```

The browser suite starts the production build on port 3100 and checks desktop/light and 360 px/dark Chromium. It uses `/usr/bin/chromium` when available; otherwise run `npx playwright install chromium` first. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use another installed Chromium. Stop any server on port 3100 before the suite. Real iPhone Safari still needs a device check.

The heading font is self-hosted with its license. The AI prompt comes directly from `prompts/extract-to-passclip.txt` at build time through a local text loader; the browser tests check that copying it preserves the file exactly.

## How to work on it

1. Open the project in Claude Code.
2. Say: "Read CLAUDE.md and docs/SPEC.md, then build the next milestone." `docs/DECISIONS.md` shows how far it got.
3. Go one milestone at a time, and check the result before starting the next one.

Milestones 0 and 1 don't need anything from Apple.

## Configure real Wallet passes

You need:

- a paid Apple Developer Program membership,
- a Pass Type ID and its certificate,
- Apple's WWDR intermediate certificate.

SPEC §6 shows how to turn these into the values in `.env.local`. Then run `npm run check:env` to check them.

## Try the AI prompt today

Copy everything in `prompts/extract-to-passclip.txt`, paste it into Claude, ChatGPT or Gemini, then paste a real ticket email under it. Compare the JSON you get with the files in `examples/`.

## Native iOS prototype and signing backend

The SwiftUI app and Share Extension are under [`ios/`](ios/README.md). Generate the Xcode project on a Mac using the included XcodeGen specification. The [macOS CI build and simulator tests passed](https://github.com/noahyao1024/passclip/actions/runs/37100373720); real device acceptance remains pending.

M2's backend exposes `/api/import` for native validation and `/api/pass` for signed Wallet downloads. The website enables its navigation form only when signing configuration passes inspection. Set `PUBLIC_BASE_URL` to the public site address when running behind a proxy. `npm run gen:images` refreshes placeholder art; after `npm run build`, `npm run smoke:signing` exercises all six examples and a real browser download using temporary test certificates. It requires OpenSSL, Python, a Chromium executable, and a free port 3101. Test certificates are never suitable for real Wallet passes.

Before M2 can ship, you still need genuine Apple certificates, checks on a real iPhone, Apple's official badge artwork (see `public/wallet/README.md`) and a shared per-IP rate limit at your host.
