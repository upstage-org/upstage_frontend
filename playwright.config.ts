import "./tests/e2e/e2e-env-bootstrap";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

import { E2E_PLAYWRIGHT_VITE_PORT, loadE2eConfig } from "./tests/e2e/e2e-config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const e2eCfg = loadE2eConfig();
const BASE_URL = e2eCfg.baseUrl;
const HEADLESS = e2eCfg.headless;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  globalSetup: path.join(__dirname, "tests/e2e/global-setup.ts"),
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: HEADLESS,
    launchOptions: {
      // Audio policy is mode-dependent:
      //   • headless (CI / fast runs): mute audio. meSpeak still gets called
      //     (the test asserts on the bubble, which is the side-effect proof
      //     that SPEAK round-tripped) but no sound leaves the container.
      //   • headed (operator watching the play): un-mute, AND disable
      //     Chromium's autoplay-needs-user-gesture policy so meSpeak's
      //     audio element can `.play()` from an MQTT callback rather than a
      //     real click. Without this flag headed runs are still silent.
      args: HEADLESS ? ["--mute-audio"] : ["--autoplay-policy=no-user-gesture-required"],
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
    {
      // Stage features that perform.spec.ts deliberately doesn't exercise:
      // drawing, drawing-as-avatar, opacity, depth. Same `setup` dep so
      // runtime.json is guaranteed; runs after setup but in parallel-eligible
      // order with perform (we keep workers=1 globally for MQTT safety).
      name: "features",
      testMatch: /features\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    {
      // Performer-streams + audience-views coverage:
      //   • Embedded MeetingObject: verifies the post-"option B" iframe
      //     Permissions Policy boundary (audience iframe MUST NOT delegate
      //     camera/microphone) and the role-aware URL-fragment config.
      //   • Yourself.vue local preview: with Chromium fake-media flags the
      //     performer's webcam tile gets a synthetic feed end-to-end, so
      //     we can assert <video> attributes (muted, playsinline, PiP off)
      //     and that the createLocalTracks→attach→play pipeline produces
      //     decoded frames (videoWidth > 0).
      //
      // The fake-media flags are required for the Yourself.vue test:
      //   • --use-fake-ui-for-media-stream     auto-grants the camera/mic
      //                                        permission prompt
      //   • --use-fake-device-for-media-stream serves a synthetic webcam
      //                                        + mic so getUserMedia
      //                                        resolves without real
      //                                        hardware
      // They are scoped to this project (not the global launchOptions)
      // because no other spec calls getUserMedia.
      name: "streaming",
      testMatch: /streaming\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            ...(HEADLESS ? ["--mute-audio"] : ["--autoplay-policy=no-user-gesture-required"]),
          ],
        },
      },
      dependencies: ["setup"],
    },
  ],
  webServer: e2eCfg.webServerStartsVite
    ? {
        command: "pnpm dev",
        port: E2E_PLAYWRIGHT_VITE_PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
