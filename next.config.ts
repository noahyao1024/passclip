import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// Apple's official badge artwork, added by the owner under Apple's license (public/wallet/README.md).
// Checked at build time: hosts may serve public/ from a CDN, out of the server's reach.
const hasWalletBadge = ["public/wallet/add-to-apple-wallet.svg", "public/wallet/add-to-apple-wallet-outline.svg"].every((file) => existsSync(file));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: { WALLET_BADGE: hasWalletBadge ? "1" : "" },
  outputFileTracingIncludes: { "/api/pass": ["./pass-models/default.pass/*.png"] },
  turbopack: {
    rules: {
      "*.txt": {
        // Next 16.3.8's built-in raw type produces an undefined default export.
        loaders: ["./scripts/raw-text-loader.cjs"],
        as: "*.js",
      },
    },
  },
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
