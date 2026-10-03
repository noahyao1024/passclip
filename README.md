# Passclip

Passclip turns tickets, bookings, memberships and coupons into Apple Wallet passes. Phase 1 is a website: drop the JSON from any AI chat, check the preview, and add the pass to Wallet.

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
npm install
npm run dev
```

Then open http://localhost:3000. `CLAUDE.md` lists every command.

## How to work on it

1. Open the project in Claude Code.
2. Say: "Read CLAUDE.md and docs/SPEC.md, then build the next milestone." `docs/DECISIONS.md` shows how far it got.
3. Go one milestone at a time, and check the result before starting the next one.

Milestones 0 and 1 don't need anything from Apple.

## Before Milestone 2 (real Wallet passes)

You need:

- a paid Apple Developer Program membership,
- a Pass Type ID and its certificate,
- Apple's WWDR intermediate certificate.

SPEC §6 shows how to turn these into the values in `.env.local`. Then run `npm run check:env` to check them.

## Try the AI prompt today

Copy everything in `prompts/extract-to-passclip.txt`, paste it into Claude, ChatGPT or Gemini, then paste a real ticket email under it. Compare the JSON you get with the files in `examples/`.
