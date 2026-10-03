import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);

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
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 60_000,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
