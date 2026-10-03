# Passclip: notes for Claude Code

Passclip (working name) turns structured text into Apple Wallet passes. Phase 1 is a website, the "drop site": people get JSON from any AI chat using our prompt, drop it on the site, check a preview, and add the pass to Apple Wallet.

Read `docs/SPEC.md` before starting or changing a milestone, and work through the milestones in SPEC §12 in order. The owner is building this as a first product: explain decisions briefly, in plain English.

## Source of truth

- Import format: `schema/passclip-import.v1.schema.json` (JSON Schema 2020-12). Don't rename or remove fields without bumping `schemaVersion` and updating the prompt, examples and types together.
- AI prompt: `prompts/extract-to-passclip.txt`. The Copy AI prompt button copies this file verbatim. Never duplicate the prompt text in code.
- Fixtures (see `examples/README.md`):
  - `examples/*.json` must validate as-is.
  - `examples/recoverable/*` must parse after lenient fixes, with a warning per fix.
  - `examples/invalid/*` must fail with readable messages.

## Stack

- Next.js (App Router), TypeScript (strict), Tailwind
- `ajv` (2020 build, `ajv/dist/2020`) for validation
- `passkit-generator` for building and signing passes (Node.js runtime only)
- `luxon` for time zones
- `@zxing/browser` for barcode decoding, `bwip-js` for barcode previews
- Vitest for tests, npm for packages
- Next.js 16 differs from older versions. Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (see @AGENTS.md, which `next dev` maintains).

## Rules

1. Never commit certificates, keys or `.env*` files (except `.env.example`). Secrets come only from env vars.
2. Never log request bodies, pass contents, names or barcodes.
3. Never generate, guess or "fix" a barcode. It comes from the import or a real decode, and the user confirms it.
4. The import → pass.json mapping lives in pure, unit-tested functions in `src/lib/pass/`. No mapping logic in route handlers or components.
5. Lenient in, strict out: recover from code fences, prose, curly quotes, trailing commas and unknown keys (with warnings), and always emit valid pass.json.
6. Pass and calendar routes run on the Node.js runtime and are reached by a real navigation (form POST), not fetch plus blob URLs.
7. UI copy: sentence case, active voice, buttons say exactly what happens, errors explain how to fix the problem.
8. When an Apple Wallet detail is uncertain, check Apple's docs (SPEC §14) instead of guessing, and record what you verified in `docs/DECISIONS.md`.
9. Before calling a task done, run `npm run typecheck && npm run lint && npm test`.

## Target layout

```
CLAUDE.md, AGENTS.md (managed by Next.js), README.md, .env.example
docs/            SPEC.md, DECISIONS.md
schema/          passclip-import.v1.schema.json
prompts/         extract-to-passclip.txt
examples/        valid fixtures, recoverable/, invalid/
pass-models/     default.pass/ (icon and logo PNGs, base pass.json)
scripts/         validate-examples.ts, gen-types.ts, check-env.ts, make-placeholder-images.ts, lib/ (shared with tests)
src/app/         page.tsx (drop site), privacy/page.tsx, api/pass/route.ts, api/ics/route.ts
src/lib/import/  parse.ts, validate.ts, messages.ts, normalize.ts, types.ts (generated)
src/lib/pass/    map.ts (+ one mapper per type), colors.ts, semantics.ts, build.ts, signing.ts
src/lib/calendar/ ics.ts
src/components/  DropZone, CopyPromptButton, PassPreview, PassResult, BarcodeHelper
tests/           contract tests over examples/ (unit tests sit next to their code as *.test.ts)
```

## Commands

Keep these current:

- `npm install`: install packages (Node.js 20.9 or later; developed on Node 22)
- `npm run dev`: start the site at http://localhost:3000
- `npm run build`: production build
- `npm test`: unit and contract tests, once; `npm run test:watch` re-runs them on every change
- `npm run lint`: ESLint
- `npm run typecheck`: generates Next's route types (`next typegen`), then runs `tsc --noEmit`
- `npm run validate:examples`: check every `examples/*.json` against the schema (`npm test` covers the recoverable and invalid fixtures)
- `npm run gen:types`: regenerate `src/lib/import/types.ts` and the precompiled validator (`schema-validator.generated.ts`) from the schema. A test fails if you forget.
- `npm run check:env`: check the pass signing settings in `.env.local`. It exits with an error until they're set up.
