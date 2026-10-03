# Going live: your checklist

Everything Passclip needs from you to make real Wallet passes and put the site online. The code is done and tested; these steps need your Apple account, your hosting account and your iPhone. Allow about an hour, plus Apple's wait for the membership.

Secrets (certificates and keys) go only into your hosting settings. Never paste them into a chat, an issue or a commit.

## 1. Join the Apple Developer Program

Sign up in the Apple Developer app on your iPhone, or at [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/). It's a paid yearly membership. Your phone is enough for this step. When it's approved, note your **Team ID**: 10 letters and digits, shown under Membership details.

## 2. Create a Pass Type ID

On [developer.apple.com/account](https://developer.apple.com/account): **Certificates, Identifiers & Profiles → Identifiers → +** → **Pass Type IDs**. Use something like `pass.com.yourdomain.passclip`. This is your **PASS_TYPE_IDENTIFIER**.

## 3. Make the pass certificate (any computer, about 10 minutes)

A Mac isn't required. In a terminal (macOS and Linux have OpenSSL; on Windows, use WSL or Git Bash):

```
openssl req -new -newkey rsa:2048 -nodes -keyout signerKey.pem -out request.csr -subj "/CN=Passclip pass signing"
```

This makes your private key (`signerKey.pem`, keep it secret) and a request file (`request.csr`).

1. On Apple's site, open your Pass Type ID, choose **Create Certificate**, and upload `request.csr`.
2. Download the certificate (`pass.cer`) and convert it:
   ```
   openssl x509 -inform der -in pass.cer -out signerCert.pem
   ```
3. Download Apple's WWDR intermediate certificate, generation G4 (valid until 2030), from [apple.com/certificateauthority](https://www.apple.com/certificateauthority/) ("Worldwide Developer Relations - G4"), and convert it:
   ```
   openssl x509 -inform der -in AppleWWDRCAG4.cer -out wwdr.pem
   ```
4. Turn each file into one line of text for your host's settings:
   ```
   base64 < signerCert.pem | tr -d '\n'
   base64 < signerKey.pem | tr -d '\n'
   base64 < wwdr.pem | tr -d '\n'
   ```

If you use Keychain Access on a Mac instead, follow SPEC §6; your key will then have a passphrase.

## 4. Check the settings before going live (optional, recommended)

In your copy of the project, create `.env.local` (it's never committed) with the values from `.env.example`, then run:

```
npm run check:env
```

It confirms the certificate matches your Pass Type ID and Team ID, the key belongs to it, Apple's WWDR certificate issued it, and nothing has expired. It never prints the secrets.

## 5. Put the site online (Vercel, about 10 minutes, phone or computer)

1. At [vercel.com/new](https://vercel.com/new), import the `passclip` GitHub repository. Vercel detects Next.js; keep the defaults.
2. Under **Settings → Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `PASS_TYPE_IDENTIFIER` | from step 2 |
   | `APPLE_TEAM_ID` | from step 1 |
   | `PASS_SIGNER_CERT_PEM_BASE64` | the `signerCert.pem` line |
   | `PASS_SIGNER_KEY_PEM_BASE64` | the `signerKey.pem` line |
   | `PASS_SIGNER_KEY_PASSPHRASE` | only if your key has one |
   | `APPLE_WWDR_CERT_PEM_BASE64` | the `wwdr.pem` line |
   | `PUBLIC_BASE_URL` | your site's address, like `https://passclip.example.com` |

3. Redeploy. When signing is set up correctly, each pass shows **Add to Apple Wallet**; otherwise the site says it's a preview.

Rate limiting works per visitor on Vercel automatically. For one limit shared across all servers, also add a rate-limit rule in Vercel's Firewall. On another host, set `RATE_LIMIT_IP_HEADER` (see `.env.example`).

## 6. Add Apple's badge

Apple requires its own "Add to Apple Wallet" artwork, under a license only you can accept. Follow [`public/wallet/README.md`](../public/wallet/README.md): download the files, then add the two SVGs to `public/wallet/` (GitHub's **Add file → Upload files** works from a browser). Vercel redeploys and the badge appears.

## 7. Check it on your iPhone (about 20 minutes)

Open the site in Safari on your iPhone and go through the list:

- [ ] **Try an example**, then **Add to Apple Wallet**: the pass opens in Wallet, and the fields and colors match the preview.
- [ ] Every example in `examples/` adds, and its barcode scans with another phone.
- [ ] **Add to calendar** opens the event with the right local time and a reminder (also try it on a Mac, and in Google Calendar).
- [ ] The barcode helper reads a screenshot of a real ticket's code.
- [ ] Dark mode, a narrow screen, and the back of each pass (tap it), including links.
- [ ] If your iPhone runs iOS 27: the grocery card's EAN-13 barcode shows in Wallet. Also try a Codabar card (D17 explains why).
- [ ] On Apple Watch, passes appear (Code 128 barcodes won't show there; that's expected).

Tell Claude Code anything that looks wrong. It can fix the code, but it can't see your phone.

## 8. The iPhone app (needs a Mac with Xcode)

See [`ios/README.md`](../ios/README.md). Cloud builds and simulator tests already pass. Installing on your own iPhone needs Xcode, your Team ID and your own bundle IDs.
