# Placeholder pass model

`npm run gen:images` deterministically creates the six images in `default.pass/`. Sizes follow Apple's Human Interface Guidelines for Wallet (checked 2026-10-03, docs/DECISIONS.md D13):

- `icon.png`: 38×38 pt, plus @2x (76×76) and @3x (114×114). Every pass needs it; it shows in notifications, so it has an opaque background.
- `logo.png`: 160×50 pt (Apple allows 50–160 pt wide, 50 pt tall), plus @2x and @3x. It sits on the pass color, so it's transparent.

The clip shape is neutral placeholder art, not Apple's Wallet badge. Replace it with final brand art and check it on a real device before launch. The builder packages only these six images with the pass.json made in memory; no imported attachments or keys go into a pass. The route's Next output tracing includes the images in standalone deployments.
