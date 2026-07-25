#!/usr/bin/env node
/**
 * Chat tool-strip overlap check (public #chatbox, #player-chatbox, and the
 * standalone /chat/<stage> window).
 *
 * Guards the in-flow `.actions` header row: previously the strip was
 * position:absolute over the scrollable .card-content, so once the thread
 * scrolled, message text slid underneath the buttons. Verifies:
 *   • messages area starts BELOW the actions row (no geometric overlap)
 *   • elementFromPoint across the actions band never hits message text,
 *     at every scroll position (top / middle / bottom)
 *   • every action button is hit-testable
 *   • the input footer stays inside the card (incl. collapsed public chat)
 *
 * Needs the e2e stack: backend :9092 + vite-e2e SPA :3001 (see env/README).
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const USER = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const STAGE = process.env.STAGE_URL ?? "/r-and-j-a1s1-1784901";
const SHOT = process.env.SHOT_DIR ?? ".";

const log = (...a) => console.log("[chat-overlap]", ...a);
let failures = 0;
const check = (ok, label) => {
  console.log(`[chat-overlap] ${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures += 1;
};

/** Push synthetic messages straight into the Pinia store (no MQTT needed). */
const injectMessages = (page, field, count) =>
  page.evaluate(
    ([field, count]) => {
      const list = window.__UPSTAGE_PINIA__.stage.chat[field];
      for (let i = 0; i < count; i++) {
        list.push({
          user: `probe${i}`,
          message: `overlap probe message ${i} — the quick brown fox jumps over the lazy dog`,
          isPlayer: i % 2 === 0,
          at: new Date().toISOString(),
          read: true,
        });
      }
      return list.length;
    },
    [field, count],
  );

/**
 * Probe one chat card. Asserts the actions band is never covering message
 * text at any scroll position and that buttons/footer are usable.
 */
async function probeCard(page, sel, name, { hasFooter = true } = {}) {
  const card = page.locator(sel);
  await card.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(600); // enter animation

  for (const pos of ["top", "middle", "bottom"]) {
    await page.evaluate(
      ([sel, pos]) => {
        const content = document.querySelector(`${sel} .card-content`);
        const max = content.scrollHeight - content.clientHeight;
        content.scrollTop = pos === "top" ? 0 : pos === "middle" ? max / 2 : max;
      },
      [sel, pos],
    );
    await page.waitForTimeout(150);

    const r = await page.evaluate(
      ([sel]) => {
        const card = document.querySelector(sel);
        const actions = card.querySelector(".actions");
        const content = card.querySelector(".card-content");
        const a = actions.getBoundingClientRect();
        const c = content.getBoundingClientRect();
        // Sample a horizontal band through the middle of the actions row.
        const hits = [];
        for (let i = 0; i <= 10; i++) {
          const x = a.left + 4 + ((a.width - 8) * i) / 10;
          const y = a.top + a.height / 2;
          const el = document.elementFromPoint(x, y);
          hits.push(
            el
              ? {
                  cls: el.className?.toString?.() ?? "",
                  inMsg: !!el.closest(".chat-line, .message, .chat-messages-scroll-inner"),
                }
              : null,
          );
        }
        return {
          actionsBottom: a.bottom,
          contentTop: c.top,
          overlapHits: hits.filter((h) => h && h.inMsg).map((h) => h.cls),
          scrollable: content.scrollHeight > content.clientHeight,
        };
      },
      [sel],
    );
    check(r.scrollable, `${name}@${pos}: content is scrollable (test precondition)`);
    check(
      r.actionsBottom <= r.contentTop + 1,
      `${name}@${pos}: messages area starts below actions row (${Math.round(r.actionsBottom)} <= ${Math.round(r.contentTop)})`,
    );
    check(
      r.overlapHits.length === 0,
      `${name}@${pos}: no message text under the tool strip${r.overlapHits.length ? ` (hit: ${r.overlapHits[0]})` : ""}`,
    );
  }

  // Every visible action button must be hit-testable at its center.
  const buttons = await page.evaluate(
    ([sel]) => {
      const out = [];
      document.querySelectorAll(`${sel} .actions button`).forEach((b) => {
        const r = b.getBoundingClientRect();
        if (!r.width || !r.height) return; // hidden (e.g. standalone)
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        out.push({ ok: !!el && (b.contains(el) || el.contains(b)), cls: el?.className?.toString?.() ?? "none" });
      });
      return out;
    },
    [sel],
  );
  check(buttons.length > 0, `${name}: actions row has visible buttons (${buttons.length})`);
  buttons.forEach((b, i) => check(b.ok, `${name}: button ${i} hit-testable (blocker: ${b.ok ? "-" : b.cls})`));

  if (hasFooter) {
    const f = await page.evaluate(
      ([sel]) => {
        const card = document.querySelector(sel);
        const footer = card.querySelector(".card-footer");
        const input = card.querySelector("textarea, input");
        return {
          cardBottom: card.getBoundingClientRect().bottom,
          footerBottom: footer?.getBoundingClientRect().bottom ?? -1,
          inputVisible: !!input && input.getBoundingClientRect().height > 0,
        };
      },
      [sel],
    );
    check(
      f.footerBottom > 0 && f.footerBottom <= f.cardBottom + 2,
      `${name}: input footer inside the card (${Math.round(f.footerBottom)} <= ${Math.round(f.cardBottom)})`,
    );
    check(f.inputVisible, `${name}: chat input visible`);
  }
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

  // ---- Live stage: public chat + player chat ----
  await page.goto(STAGE);
  await page.waitForFunction(() => window.__UPSTAGE_PINIA__?.stage?.model, null, { timeout: 30000 });
  await page.waitForFunction(() => !window.__UPSTAGE_PINIA__.stage.preloading, null, { timeout: 60000 });
  // Dismiss the Preloader curtain (click-to-enter cover) if it's up.
  const curtain = page.locator("section.hero.cover-image");
  if (await curtain.isVisible().catch(() => false)) {
    await curtain.click();
    await curtain.waitFor({ state: "hidden", timeout: 15000 });
  }
  await page.waitForTimeout(1500);

  await injectMessages(page, "messages", 30);
  await probeCard(page, "#chatbox", "public-chat");
  await page.screenshot({ path: `${SHOT}/chat-overlap-public.png` });

  // Collapsed public chat: minimise, footer must stay inside the card.
  await page.evaluate(() => {
    document.querySelector("#chatbox .actions button").click();
  });
  await page.waitForTimeout(600);
  const collapsed = await page.evaluate(() => {
    const card = document.querySelector("#chatbox");
    const r = card.getBoundingClientRect();
    const footer = card.querySelector(".card-footer").getBoundingClientRect();
    const actions = card.querySelector(".actions").getBoundingClientRect();
    return { h: r.height, footerInside: footer.bottom <= r.bottom + 2 && footer.top >= r.top, actionsInside: actions.bottom <= r.bottom + 2, bottom: r.bottom, vh: window.innerHeight };
  });
  check(collapsed.h > 60 && collapsed.h < 180, `public-chat collapsed: compact height (${Math.round(collapsed.h)}px)`);
  check(collapsed.footerInside, "public-chat collapsed: input footer inside the card");
  check(collapsed.actionsInside, "public-chat collapsed: actions row inside the card");
  check(collapsed.bottom <= collapsed.vh, `public-chat collapsed: card stays on screen (bottom ${Math.round(collapsed.bottom)} <= ${collapsed.vh})`);
  await page.screenshot({ path: `${SHOT}/chat-overlap-collapsed.png` });
  await page.evaluate(() => document.querySelector("#chatbox .actions button").click()); // maximise back
  await page.waitForTimeout(600);

  // Player chat
  await page.evaluate(() => window.__UPSTAGE_PINIA__.stage.setShowPlayerChat(true));
  await injectMessages(page, "privateMessages", 30);
  await probeCard(page, "#player-chatbox", "player-chat");
  await page.screenshot({ path: `${SHOT}/chat-overlap-player.png` });

  // ---- Standalone /chat/<stage> window ----
  await page.goto(`/chat${STAGE}`);
  await page.waitForFunction(() => window.__UPSTAGE_PINIA__?.stage?.model, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await injectMessages(page, "messages", 30);
  await probeCard(page, "#chatbox", "standalone-chat");
  await page.screenshot({ path: `${SHOT}/chat-overlap-standalone.png` });
} catch (e) {
  failures += 1;
  log("ERROR:", e.message);
  await page.screenshot({ path: `${SHOT}/chat-overlap-error.png` }).catch(() => {});
} finally {
  await browser.close();
  log(failures ? `${failures} FAILURE(S)` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}
