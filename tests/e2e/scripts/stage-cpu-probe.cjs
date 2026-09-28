// Diagnostic: enter a stage as a logged-in player and report how busy the
// page's main thread is while nothing happens, plus console warnings/errors.
//
//   node tests/e2e/scripts/stage-cpu-probe.cjs [/stage-slug]
const { chromium } = require("@playwright/test");
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const slug = process.argv[2] ?? require("../runtime.json").stageUrl;
const tools = (process.env.PROBE_TOOLS ?? "").split(",").filter(Boolean);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const messages = new Map();
  const note = (text) => messages.set(text, (messages.get(text) ?? 0) + 1);
  page.on("console", (m) => ["error", "warning"].includes(m.type()) && note(m.text().slice(0, 200)));
  page.on("pageerror", (e) => note("pageerror: " + String(e).slice(0, 200)));
  page.on("crash", () => note("PAGE CRASHED"));

  await page.goto(BASE + "/login");
  await page.locator('input[name="username"]').first().fill(ADMIN);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login")),
    page.locator('button[type="submit"]').first().click(),
  ]);
  await page.goto(BASE + slug);
  await page.locator("#board").waitFor({ timeout: 60000 });
  await page.waitForTimeout(5000);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const busy = async (label, ms) => {
    const read = async () =>
      Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const before = await read();
    await page.waitForTimeout(ms);
    const after = await read();
    const share = ((after.TaskDuration - before.TaskDuration) / (ms / 1000)) * 100;
    console.log(
      `${label}: main thread busy ${share.toFixed(1)}%, heap ${(after.JSHeapUsedSize / 1e6).toFixed(0)} MB, nodes ${after.Nodes}`,
    );
  };
  await busy("idle on stage", 8000);
  for (const tool of tools) {
    await page.locator(`.panel-block.button:has(img[src*="${tool}"])`).first().dispatchEvent("click");
    await busy(`tool ${tool} open`, 6000);
    if (process.env.E2E_SHOT_DIR)
      await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/tool-${tool.replace(/\W/g, "")}.png` });
  }
  for (const [text, count] of messages) console.log(`console x${count}: ${text}`);
  await browser.close();
})().catch((e) => {
  console.error("probe failed:", String(e).slice(0, 400));
  process.exit(1);
});
