import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
