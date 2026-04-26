import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env.test wins over the SPA's runtime .env so e2e knobs don't poison Vite.
loadEnv({ path: path.join(__dirname, ".env.test") });

const PORT = 3000;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
// If set, Playwright will NOT start `pnpm dev` — you must serve the SPA yourself.
// Leave `E2E_BASE_URL` unset in `.env.test` for the default (Vite on 3000).
const HAS_EXTERNAL_SERVER = Boolean(process.env.E2E_BASE_URL);
// Default to headed locally so the human can watch the play unfold; CI still
// runs headless. Override either way with `PWHEADLESS=1` (force headless) or
// `PWHEADLESS=0` (force headed).
const HEADLESS = process.env.PWHEADLESS
  ? process.env.PWHEADLESS !== "0" && process.env.PWHEADLESS.toLowerCase() !== "false"
  : Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  reporter: [
    ["html", { open: "never" }],
    ["list"],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: HEADLESS,
    launchOptions: {
      // Headless Chromium is muted so a headed local run doesn't blast 70 lines
      // of TTS at the operator. (Browser TTS is already a no-op in headless.)
      args: ["--mute-audio"],
    },
  },
  projects: [
    {
      name: "smoke",
      testMatch: /(auth|media|stage)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "setup",
      testMatch: /setup\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "perform",
      testMatch: /perform\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: HAS_EXTERNAL_SERVER
    ? undefined
    : {
        command: "pnpm dev",
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
