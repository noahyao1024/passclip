# Apple Wallet badge artwork

Apple requires its own "Add to Apple Wallet" badge on websites; don't draw your own. The artwork comes under Apple's license, so the site owner downloads it and accepts the terms:

1. Open Apple's [Add to Apple Wallet guidelines](https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/) and choose **Download badge files**.
2. From the US English SVG files, copy two badges here with exactly these names:
   - `add-to-apple-wallet.svg`: the standard (black) badge, for light backgrounds.
   - `add-to-apple-wallet-outline.svg`: the outline badge, for dark mode.
3. Run `npm run build`. The build sees both files and the site switches from a text button to the badge.

The site never dims or redraws the badge: when pass signing isn't set up, it shows a note instead of a button.
