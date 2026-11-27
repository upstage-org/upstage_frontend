// Browser check: the left #toolbox strip highlights exactly the open tool.
//
//   node tests/e2e/scripts/toolbox-highlight-check.cjs [/stage-slug]
const { chromium } = require("@playwright/test");
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const slug = process.argv[2] ?? require("../runtime.json").stageUrl;

let failed = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  await page.goto(BASE + "/login");
  await page.locator('input[name="username"]').first().fill(ADMIN);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login")),
    page.locator('button[type="submit"]').first().click(),
  ]);
  await page.goto(BASE + slug);
  await page.locator("#toolbox").waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);
  // Entry screen ("click anywhere to continue") covers the stage until clicked.
  const entry = page.locator("section.hero.cover-image").first();
  if (await entry.isVisible().catch(() => false)) {
    await entry.click();
    await entry.waitFor({ state: "hidden", timeout: 15000 });
  }

  const item = (icon) => page.locator(`#toolbox .panel-block.button:has(img[src*="${icon}"])`).first();
  // Icons of the active items, read from the DOM (chat.svg = PlayerChatTool, own state).
  const active = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#toolbox .panel-block.is-active img")]
        .map((img) => img.getAttribute("src").split("/").pop().split("?")[0])
        .filter((src) => !src.startsWith("chat")),
    );
  const iconFilter = (icon) => item(icon).locator("img").evaluate((img) => getComputedStyle(img).filter);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  check("nothing highlighted before a tool is opened", same(await active(), []), JSON.stringify(await active()));

  await item("avatar.svg").click();
  await page.locator("#topbar").waitFor();
  check("Avatars highlighted while open", same(await active(), ["avatar.svg"]), JSON.stringify(await active()));
  await page.mouse.move(700, 450);
  check("open tool icon is in colour", (await iconFilter("avatar.svg")) === "none", await iconFilter("avatar.svg"));
  check("closed tool icon stays grey", (await iconFilter("prop.svg")).includes("grayscale"), await iconFilter("prop.svg"));
  if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/highlight-avatars.png` });

  await item("prop.svg").click();
  await page.waitForTimeout(300);
  check("highlight moves to Props", same(await active(), ["prop.svg"]), JSON.stringify(await active()));
  if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/highlight-props.png` });

  await item("prop.svg").click();
  await page.waitForTimeout(300);
  check("clicking the open tool again clears it", same(await active(), []), JSON.stringify(await active()));

  await item("depth.svg").click();
  await page.locator("#topbar").waitFor();
  await page.locator("#topbar .topbar-close").click();
  await page.waitForTimeout(300);
  check("panel close button clears the highlight", same(await active(), []), JSON.stringify(await active()));

  await browser.close();
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("check failed:", String(e).slice(0, 400));
  process.exit(1);
});
