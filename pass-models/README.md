# Placeholder pass model

`npm run gen:images` deterministically creates `default.pass/icon.png` at 29×29 plus 2×/3× variants, and `logo.png` at 160×50 plus variants. The white clip is neutral placeholder art, not an Apple Wallet badge. The builder loads only those six images and supplies pass.json in memory; no imported attachment files or keys are packaged.

These conventional dimensions still need verification against current Apple's pass design documentation (blocked by network policy in this cloud machine). Replace art and check rendering on real devices before launch. The route's Next output tracing includes the images in standalone deployments.
