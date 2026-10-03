import { existsSync } from "node:fs";
import { chromium, defineConfig } from "@playwright/test";
import { FAKE_STORAGE, FAKE_STORAGE_ENV } from "./tests/browser/fake-storage-settings";

// Playwright's own Chromium when it's installed (CI); otherwise a system Chromium, or the one
// preinstalled in Claude Code cloud sessions.
const systemChromium =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync(chromium.executablePath()) ? undefined : ["/usr/bin/chromium", "/opt/pw-browsers/chromium"].find((path) => existsSync(path)));

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    launchOptions: { executablePath: systemChromium },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-light", use: { browserName: "chromium", viewport: { width: 1280, height: 900 }, colorScheme: "light" } },
    { name: "mobile-dark", use: { browserName: "chromium", viewport: { width: 360, height: 800 }, colorScheme: "dark", isMobile: true, hasTouch: true } },
  ],
  webServer: [
    // A stand-in storage bucket, so file uploads can be tested end to end.
    {
      command: "npx tsx tests/browser/fake-storage.ts",
      url: `http://127.0.0.1:${FAKE_STORAGE.port}/__objects`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npm run start -- --hostname 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { NEXT_TELEMETRY_DISABLED: "1", ...FAKE_STORAGE_ENV },
    },
  ],
});
