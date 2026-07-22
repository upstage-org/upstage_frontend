#!/usr/bin/env node
/**
 * Multi-select filter clear-x vs dropdown-arrow check (Stages + Media pages).
 * Verifies the studio.less override that sits the on-hover clear "x" BESIDE
 * the dropdown arrow (antd default stacks them, making the arrow unclickable):
 *   • hovering the select shows both icons at distinct positions
 *   • clicking the arrow point opens the dropdown (does NOT clear)
 *   • clicking the "x" point clears the value (does NOT open)
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const USER = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const SHOT = process.env.SHOT_DIR ?? ".";

const log = (...a) => console.log("[filter-check]", ...a);
let failures = 0;
const check = (ok, label) => {
  console.log(`[filter-check] ${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures += 1;
};

/** Hover a select, then probe what elementFromPoint hits at each icon. */
async function probeIcons(page, select) {
  await select.hover();
  await page.waitForTimeout(400); // clear-x opacity transition
  return select.evaluate((el) => {
    const at = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        hitsSelf: !!hit && (node.contains(hit) || hit.contains(node)),
        hitClass: hit?.getAttribute("class") ?? "none",
      };
    };
    return {
      arrow: at(el.querySelector(".ant-select-arrow")),
      clear: at(el.querySelector(".ant-select-clear")),
      clearOpacity: el.querySelector(".ant-select-clear")
        ? getComputedStyle(el.querySelector(".ant-select-clear")).opacity
        : null,
    };
  });
}

async function checkSelect(page, selectIn, name) {
  // Pin the element with an attribute: value-based locators (hasText on the
  // tags) stop matching once the clear x empties the select.
  await selectIn.evaluate((el) => el.setAttribute("data-filter-check", "1"));
  const select = page.locator('[data-filter-check="1"]');
  const p = await probeIcons(page, select);
  check(!!p.arrow && !!p.clear, `${name}: both arrow and clear render (arrow=${!!p.arrow} clear=${!!p.clear})`);
  if (!p.arrow || !p.clear) return;
  check(p.clearOpacity === "1", `${name}: clear x visible on hover (opacity=${p.clearOpacity})`);
  check(p.clear.x < p.arrow.x - 8, `${name}: x sits beside arrow, not on top (x@${p.clear.x} vs arrow@${p.arrow.x})`);
  // The arrow itself is pointer-events:none (clicks fall through to the
  // selector, which opens the dropdown) — assert only that the clear x is
  // not what's covering it.
  check(!/ant-select-clear/.test(p.arrow.hitClass), `${name}: arrow point not covered by clear x (hit: ${p.arrow.hitClass})`);
  check(p.clear.hitsSelf, `${name}: clear x is hit-testable (blocker: ${p.clear.hitClass})`);

  // Clicking the arrow point must OPEN the dropdown, not clear the value.
  const before = await select.evaluate((el) => el.querySelectorAll(".ant-select-selection-item").length);
  await page.mouse.click(p.arrow.x, p.arrow.y);
  await page.waitForTimeout(300);
  const open = await select.evaluate((el) => el.classList.contains("ant-select-open"));
  const afterArrow = await select.evaluate((el) => el.querySelectorAll(".ant-select-selection-item").length);
  check(open, `${name}: clicking arrow opens dropdown`);
  check(afterArrow === before, `${name}: clicking arrow keeps value (${before} -> ${afterArrow})`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // Clicking the x point must CLEAR the value.
  const p2 = await probeIcons(page, select);
  await page.mouse.click(p2.clear.x, p2.clear.y);
  await page.waitForTimeout(300);
  const afterClear = await select.evaluate((el) => el.querySelectorAll(".ant-select-selection-item").length);
  check(afterClear === 0, `${name}: clicking x clears value (${before} -> ${afterClear})`);
  await select.evaluate((el) => el.removeAttribute("data-filter-check"));
}

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (e) => log("pageerror:", e.message));

try {
  await page.goto("/login");
  await page.locator('input[name="username"]').first().fill(USER);
  await page.locator('input[type="password"]').first().fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);

  // ---- Stages list: Access Level (pre-filled owner/editor/player) ----
  await page.goto("/stages");
  // Match on the "Editor" tag so we get Access Level (its default value is
  // owner/editor/player), not the empty Owners select whose placeholder also
  // contains "Owner".
  const access = page.locator(".ant-select-multiple").filter({ hasText: /Editor/ }).first();
  await access.waitFor({ state: "visible", timeout: 20000 });
  await page.screenshot({ path: `${SHOT}/filter-stages-before.png` });
  await checkSelect(page, access, "Stages/AccessLevel");
  await page.screenshot({ path: `${SHOT}/filter-stages-after.png` });

  // ---- Media list: Owners (select one owner first so the x renders) ----
  await page.goto("/media");
  const owners = page.locator(".ant-select-multiple").first();
  await owners.waitFor({ state: "visible", timeout: 20000 });
  if ((await owners.locator(".ant-select-selection-item").count()) === 0) {
    // Click the type-ahead input (clicking the select body can land on a
    // tag's own remove button), then pick an unselected option.
    await owners.locator("input").first().click();
    await page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option:not(.ant-select-item-option-selected)")
      .first()
      .click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await checkSelect(page, owners, "Media/Owners");
  await page.screenshot({ path: `${SHOT}/filter-media-after.png` });
} catch (e) {
  failures += 1;
  log("ERROR:", e.message);
  await page.screenshot({ path: `${SHOT}/filter-check-error.png` }).catch(() => {});
} finally {
  await browser.close();
  log(failures ? `${failures} FAILURE(S)` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}
