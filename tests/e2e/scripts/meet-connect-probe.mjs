// Probe the external Jitsi Meet web UI the same way MeetingObject's iframe
// loads it: open a room URL with the performer fragment config, watch the
// console + rendered text for connection failures.
import { chromium } from "@playwright/test";

const room = `upstage-meet-probe-${Date.now()}`;
const enc = (v) => encodeURIComponent(JSON.stringify(v));
const frag = [
  `config.prejoinPageEnabled=${enc(false)}`,
  `config.prejoinConfig=${enc({ enabled: false })}`,
  `config.startVideoMuted=${enc(1)}`,
  `config.startAudioMuted=${enc(1)}`,
  `config.disableInitialGUM=${enc(false)}`,
  `interfaceConfig.SHOW_CHROME_EXTENSION_BANNER=${enc(false)}`,
  `userInfo.displayName=${enc("probe")}`,
].join("&");
const url = `https://streaming.upstage.live/${room}#${frag}`;

const browser = await chromium.launch({
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--mute-audio"],
});
const page = await browser.newPage();
const lines = [];
page.on("console", (m) => lines.push(`[console:${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => lines.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) =>
  lines.push(`[requestfailed] ${r.url()} :: ${r.failure()?.errorText}`),
);

console.log("opening", url);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(8000);

// The current web UI shows its prejoin screen even with
// config.prejoinPageEnabled=false (renamed to prejoinConfig.enabled upstream).
// Click through it like a user would.
const joinBtn = page
  .locator('[data-testid="prejoin.joinMeeting"], [aria-label="Join meeting"]')
  .first();
if (await joinBtn.isVisible().catch(() => false)) {
  console.log(">>> prejoin screen shown — clicking Join meeting");
  await joinBtn.click().catch((e) => console.log("join click failed:", e.message));
}
await page.waitForTimeout(20000);

const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
console.log("=== visible text (trimmed) ===");
console.log(bodyText.replace(/\s+/g, " ").slice(0, 600));
console.log("=== interesting console lines ===");
for (const l of lines) {
  if (/error|fail|strophe|xmpp|websocket|CONNECTION|disconnected/i.test(l)) {
    console.log(l.slice(0, 300));
  }
}
console.log(`=== total console lines: ${lines.length} ===`);
await browser.close();
