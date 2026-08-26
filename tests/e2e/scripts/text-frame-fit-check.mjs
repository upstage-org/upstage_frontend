#!/usr/bin/env node
/**
 * Text tool frame-fit check: create a text on stage, edit it in place adding
 * lines (Enter), and verify the frame (.object) fully contains the rendered
 * ink — especially that the TOP of the first line is not clipped.
 *
 * Measures DOM rects AND does a pixel scan: screenshots the object with the
 * clip released on a clone to find where ink actually is.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const STAGE = `/${(process.env.STAGE ?? "touch-draw-test").replace(/^\//, "")}`;
const USER = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const SHOT_DIR = process.env.SHOT_DIR ?? ".";

const log = (...a) => console.log("[text-fit]", ...a);
let failures = 0;
const check = (ok, label) => {
  console.log(`[text-fit] ${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 1440, height: 900 },
  ignoreHTTPSErrors: true,
});
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

  await page.goto(STAGE);
  await page.waitForFunction(() => window.__UPSTAGE_PINIA__?.stage?.model, null, {
    timeout: 30000,
  });
  await page.waitForFunction(() => !window.__UPSTAGE_PINIA__.stage.preloading, null, {
    timeout: 60000,
  });

  const hero = page.locator("section.hero.cover-image");
  if (await hero.isVisible().catch(() => false)) {
    await hero.click();
    await hero.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  }

  // Open Text tool, create a new text.
  await page.locator('a.panel-block:has(img[src*="text.svg"])').first().click();
  await page.locator("#topbar span.tag", { hasText: /new text/i }).first().click();

  const writingP = page.locator("section.writing > p");
  await writingP.waitFor({ state: "visible", timeout: 10000 });
  // Replace placeholder with a single line.
  await writingP.evaluate((el) => {
    el.innerHTML = "what happens when i write a lot of text";
  });
  await writingP.click();
  // Save (check icon).
  await page.locator('#topbar .text-tool:has(img[src*="check.svg"])').click();

  // The new text object mounts auto-focused.
  const obj = page.locator('[data-object-type="text"]').last();
  await obj.waitFor({ state: "visible", timeout: 10000 });

  const state0 = await obj.evaluate((el) => {
    const p = el.querySelector("p");
    const o = el.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    return {
      obj: { top: o.top, left: o.left, w: o.width, h: o.height },
      p: { top: pr.top, left: pr.left, w: pr.width, h: pr.height },
      scroll: { w: p.scrollWidth, h: p.scrollHeight },
      lineHeight: cs.lineHeight,
      fontSize: cs.fontSize,
      fontFamily: cs.fontFamily,
      marginTop: cs.marginTop,
    };
  });
  log("after save:", JSON.stringify(state0));

  // Enter edit mode via the pen quick-action.
  const pen = page.locator(".quick-action button:has(i.fa-pen)").first();
  await pen.waitFor({ state: "visible", timeout: 10000 });
  await pen.click();

  const stageP = obj.locator("p[contenteditable='true']");
  await stageP.waitFor({ state: "visible", timeout: 10000 });
  await stageP.click();
  // Caret to end, then add lines like the user did.
  await page.keyboard.press("Control+End").catch(() => {});
  const extraLines = [
    "if i use the return it",
    "goes onto the next line",
    "BUT it is still losing it at the top",
    "it chops off some of the text",
  ];
  for (const line of extraLines) {
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(line, { delay: 5 });
  }
  await page.waitForTimeout(2500); // let anime.js finish animating w/h

  const state1 = await obj.evaluate((el) => {
    const p = el.querySelector("p");
    const o = el.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    const stage = window.__UPSTAGE_PINIA__.stage;
    const bo = stage.board.objects.find((x) => x.type === "text");
    return {
      obj: { top: o.top, left: o.left, w: o.width, h: o.height },
      p: { top: pr.top, left: pr.left, w: pr.width, h: pr.height },
      scroll: { w: p.scrollWidth, h: p.scrollHeight },
      store: bo ? { x: bo.x, y: bo.y, w: bo.w, h: bo.h, fontSize: bo.fontSize } : null,
      objScroll: { top: el.scrollTop, left: el.scrollLeft, h: el.scrollHeight, clientH: el.clientHeight, w: el.scrollWidth, clientW: el.clientWidth },
      innerHTML: p.innerHTML,
    };
  });
  log("after typing:", JSON.stringify(state1, null, 2));

  check(
    state1.p.top >= state1.obj.top - 0.5,
    `p top (${state1.p.top}) not above object top (${state1.obj.top})`,
  );
  check(
    state1.obj.h >= state1.scroll.h,
    `object height ${state1.obj.h} fits content scrollHeight ${state1.scroll.h}`,
  );

  // Pixel scan: screenshot the region just above and below the object's top
  // edge; the object left half is text-free (has-text-centered), use full
  // width. Compare ink rows against the object's top boundary.
  const box = await obj.boundingBox();
  const shotPath = `${SHOT_DIR}/text-fit-after-typing.png`;
  await page.screenshot({
    path: shotPath,
    clip: {
      x: Math.max(0, box.x - 20),
      y: Math.max(0, box.y - 40),
      width: box.width + 40,
      height: box.height + 80,
    },
  });
  log("screenshot:", shotPath);

  // Does the FIRST line of ink start below the frame top? Release the clip on
  // the real element (locally only) and measure how far ink would extend.
  const inkDelta = await obj.evaluate(async (el) => {
    const p = el.querySelector("p");
    const objEl = el.querySelector(".object") ?? el;
    const objTop = objEl.getBoundingClientRect().top;
    // Range over the first text node to get its line box.
    const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const first = tw.nextNode();
    if (!first) return null;
    const range = document.createRange();
    range.selectNodeContents(first);
    const lineRect = range.getClientRects()[0];
    return { lineTop: lineRect?.top, objTop, pTop: p.getBoundingClientRect().top };
  });
  log("first line box:", JSON.stringify(inkDelta));

  // Also verify the saved store height matches the DOM box (echo round trip).
  if (state1.store) {
    check(
      Math.abs(state1.store.h - state1.obj.h) < 3,
      `store h ${state1.store.h} ≈ DOM h ${state1.obj.h}`,
    );
  }

  // --- Re-edit round: leave editing, re-enter, add one more line. ---
  await pen.click(); // editing off
  await page.waitForTimeout(300);
  await pen.click(); // editing on again
  await stageP.waitFor({ state: "visible", timeout: 10000 });
  await stageP.click();
  await page.keyboard.press("Control+End").catch(() => {});
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("and one more line after re-entering edit mode", { delay: 5 });
  await page.waitForTimeout(800);
  const state2 = await obj.evaluate((el) => {
    const p = el.querySelector("p");
    const o = el.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    return {
      obj: { top: o.top, h: o.height, w: o.width },
      p: { top: pr.top, h: pr.height, w: pr.width },
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
    };
  });
  log("after re-edit:", JSON.stringify(state2));
  check(state2.p.top >= state2.obj.top - 0.5, `re-edit: p top ${state2.p.top} within frame top ${state2.obj.top}`);
  check(state2.obj.h >= state2.p.h, `re-edit: frame h ${state2.obj.h} >= text h ${state2.p.h}`);
  check(state2.scrollTop === 0 && state2.scrollLeft === 0, `re-edit: clip box not scrolled (${state2.scrollTop},${state2.scrollLeft})`);

  // --- Shrink round: still editing — replace the whole multi-line text with
  // one short line and verify the frame shrinks back to fit (two-way fit;
  // a stale oversized frame would invisibly cover the stage). ---
  await stageP.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("shrunk back", { delay: 5 });
  await page.waitForTimeout(800);
  const state3 = await obj.evaluate((el) => {
    const p = el.querySelector("p");
    const o = el.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    const stage = window.__UPSTAGE_PINIA__.stage;
    const bo = stage.board.objects.find((x) => x.type === "text");
    return {
      obj: { top: o.top, h: o.height, w: o.width },
      p: { top: pr.top, h: pr.height, w: pr.width },
      store: bo ? { w: bo.w, h: bo.h } : null,
    };
  });
  log("after shrink:", JSON.stringify(state3));
  check(state3.obj.h < state2.obj.h - 5, `shrink: frame h ${state3.obj.h} < pre-shrink ${state2.obj.h}`);
  check(state3.obj.w < state2.obj.w - 5, `shrink: frame w ${state3.obj.w} < pre-shrink ${state2.obj.w}`);
  check(state3.p.top >= state3.obj.top - 0.5, `shrink: p top ${state3.p.top} within frame top ${state3.obj.top}`);
  check(state3.obj.h >= state3.p.h - 0.5, `shrink: frame h ${state3.obj.h} still fits text h ${state3.p.h}`);
  if (state3.store) {
    check(Math.abs(state3.store.h - state3.obj.h) < 3, `shrink: store h ${state3.store.h} ≈ DOM h ${state3.obj.h}`);
  }

  // --- Broadcast + audience view: light the bulb, then look from a second
  // browser context (not logged in => audience). ---
  await pen.click(); // leave editing mode first
  await page.waitForTimeout(300);
  await page.locator(".quick-action button:has(i.fa-lightbulb)").locator("visible=true").first().click();
  await page.waitForTimeout(1000);
  const ctx2 = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page2 = await ctx2.newPage();
  await page2.goto(STAGE);
  await page2.waitForFunction(() => window.__UPSTAGE_PINIA__?.stage?.model, null, { timeout: 30000 });
  await page2.waitForFunction(() => !window.__UPSTAGE_PINIA__.stage.preloading, null, { timeout: 60000 });
  const hero2 = page2.locator("section.hero.cover-image");
  if (await hero2.isVisible().catch(() => false)) {
    await hero2.click();
    await hero2.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  }
  const audObj = page2.locator('[data-object-type="text"]').last();
  const audSeen = await audObj
    .waitFor({ state: "visible", timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check(audSeen, "audience sees the text object");
  if (audSeen) {
    const aud = await audObj.evaluate((el) => {
      const p = el.querySelector("p");
      const o = el.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      return {
        obj: { top: o.top, h: o.height, w: o.width },
        p: { top: pr.top, h: pr.height, w: pr.width },
        scrollTop: el.scrollTop,
        text: p.innerText,
      };
    });
    log("audience view:", JSON.stringify(aud));
    check(aud.p.top >= aud.obj.top - 0.5, `audience: p top ${aud.p.top} within frame top ${aud.obj.top}`);
    check(aud.obj.h >= aud.p.h - 0.5, `audience: frame h ${aud.obj.h} >= text h ${aud.p.h}`);
    check(aud.text.includes("shrunk back"), "audience sees the full latest content");
    const audBox = await audObj.boundingBox();
    await page2.screenshot({
      path: `${SHOT_DIR}/text-fit-audience.png`,
      clip: { x: Math.max(0, audBox.x - 20), y: Math.max(0, audBox.y - 40), width: audBox.width + 40, height: audBox.height + 80 },
    });
  }
  await ctx2.close();

  // Cleanup: delete the text object so the stage stays tidy.
  await obj.evaluate((el) => {
    const stage = window.__UPSTAGE_PINIA__.stage;
    stage.board.objects
      .filter((o) => o.type === "text")
      .forEach((o) => stage.deleteObject(o));
    // also drop from saved texts strip
    (stage.board.texts ?? []).slice().forEach((t) => stage.POP_TEXT(t.textId));
  });

  process.exitCode = failures ? 1 : 0;
  log(failures ? `${failures} FAILURES` : "ALL PASS");
} catch (err) {
  log("ERROR:", err?.message ?? err);
  await page.screenshot({ path: `${SHOT_DIR}/text-fit-error.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
