// Apple's rules for the web badge (Add to Apple Wallet guidelines, checked 2026-10-03, D14):
// use Apple's own SVG artwork, never a redrawn, dimmed or animated version; keep clear space of
// 10% of its height around it; use the outline version on dark backgrounds. Apple licenses the
// artwork, so the owner adds it to public/wallet/ (see the README there). Until then a plain
// text button stands in, and with no signing there's no button at all, never a dimmed one.

/** Set at build time by next.config.ts when both badge files are in public/wallet/. */
const HAS_OFFICIAL_BADGE = process.env.WALLET_BADGE === "1";

export function AddToWallet({ importText, fallbackTimeZone }: { importText: string; fallbackTimeZone: string }) {
  return (
    // A real navigation, so iPhone Safari shows its Add to Wallet sheet (CLAUDE.md rule 6).
    <form method="post" action="/api/pass" target="_self">
      <input type="hidden" name="import" value={importText} />
      <input type="hidden" name="fallbackTimeZone" value={fallbackTimeZone} />
      {HAS_OFFICIAL_BADGE ? (
        <button className="wallet-badge" type="submit">
          <picture>
            <source srcSet="/wallet/add-to-apple-wallet-outline.svg" media="(prefers-color-scheme: dark)" />
            <img src="/wallet/add-to-apple-wallet.svg" alt="Add to Apple Wallet" height={44} />
          </picture>
        </button>
      ) : (
        <button className="button button-secondary" type="submit">Add to Apple Wallet</button>
      )}
    </form>
  );
}
