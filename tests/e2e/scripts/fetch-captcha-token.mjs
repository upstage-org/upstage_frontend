/**
 * One-off: open dev login, wait for Turnstile, print cf-turnstile-response for .env.test
 * Usage: node tests/e2e/scripts/fetch-captcha-token.mjs [baseUrl]
 */
import { chromium } from "@playwright/test";

const baseUrl = process.argv[2]?.replace(/\/$/, "") || "https://dev.upstage.live";
const username = process.env.E2E_ADMIN_USERNAME || "admin";
const password = process.env.E2E_ADMIN_PASSWORD || "Secret@123";

const headless = process.env.PWHEADLESS !== "0" && process.env.PWHEADLESS?.toLowerCase() !== "false";
const browser = await chromium.launch({ headless });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(120_000);
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator('input[name="username"]').first().fill(username);
  await page.locator('input[type="password"]').first().fill(password);

  const turnstile = page.locator('input[name="cf-turnstile-response"]');
  if ((await turnstile.count()) === 0) {
    console.error("[fetch-captcha] No Turnstile input — captcha may be disabled on this build.");
    process.exit(2);
  }

  await page.waitForFunction(
    () => {
      const el = document.querySelector('input[name="cf-turnstile-response"]');
      return el?.value && el.value.length > 5;
    },
    { timeout: 120_000 },
  );

  const token = await turnstile.inputValue();
  if (!token) {
    console.error("[fetch-captcha] Turnstile input empty after wait.");
    process.exit(2);
  }
  console.log(token);
} finally {
  await browser.close();
}
