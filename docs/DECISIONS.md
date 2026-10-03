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
