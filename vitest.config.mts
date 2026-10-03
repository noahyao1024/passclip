import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Lets tests use the same "@/..." imports as the app (tsconfig.json paths).
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
