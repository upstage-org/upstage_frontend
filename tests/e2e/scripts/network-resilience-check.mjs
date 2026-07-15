#!/usr/bin/env node
/**
 * Live check for the 2026-07-15 network-resilience work (Apollo RetryLink +
 * timeout fetch + throttled friendly toast + router stale-chunk reload).
 *
 * Drives a REAL browser against the deployed SPA and injures the network at
 * the request layer (playwright route aborts = the browser's own
 * "TypeError: Failed to fetch"), which is exactly what a wifi↔cellular
 * switch produces. Verifies:
 *   1. GraphQL queries survive a transient blip: the first two fetches of
 *      every operation are aborted, yet page content loads with NO error
 *      toast (RetryLink replayed them).
 *   2. A dead network surfaces exactly ONE friendly toast (keyed+throttled),
 *      not a stack of raw "[Network error]: TypeError: Failed to fetch",
 *      and each GraphQL operation was attempted multiple times first.
 *   3. A lazy route chunk that fails to load triggers the router's one-shot
 *      full reload and the destination page still renders.
 *
 * Usage (against an already-running deployment):
 *   node tests/e2e/scripts/network-resilience-check.mjs
 * Env:
 *   NETCHECK_BASE_URL   default https://dev.upstage.live
 */
import { chromium } from "@playwright/test";

const BASE = process.env.NETCHECK_BASE_URL ?? "https://dev.upstage.live";
const GRAPHQL = "**/studio_graphql";
const FRIENDLY_TOAST = "Network connection problem";
const RAW_TOAST = "[Network error]";

const log = (...a) => console.log("[net-check]", ...a);
let failures = 0;
const check = (ok, label) => {
  console.log(`[net-check] ${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });

async function newPage() {
  const context = await browser.newContext({
    baseURL: BASE,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => log("pageerror:", e.message));
  return { context, page };
}

const opName = (request) => {
  try {
    return JSON.parse(request.postData() ?? "{}").operationName ?? "(anonymous)";
  } catch {
    return "(unparseable)";
  }
};

async function toastTexts(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".ant-message-notice, .ant-message-notice-content")).map(
      (el) => el.textContent ?? "",
    ),
  );
}

// ---------------------------------------------------------------------------
// 1. Transient blip: first 2 fetches of each GraphQL operation abort, then
//    the network "recovers". Content must still load, with no toast at all.
// ---------------------------------------------------------------------------
{
  const { context, page } = await newPage();
  const attempts = new Map();
  await page.route(GRAPHQL, async (route) => {
    const name = opName(route.request());
    const n = (attempts.get(name) ?? 0) + 1;
    attempts.set(name, n);
    if (n <= 2) {
      await route.abort("internetdisconnected");
    } else {
      await route.continue();
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  // RetryLink backoff: attempts 1+2 fail, attempt 3 lands after ~1.2s+jitter.
  await sleep(9_000);

  const retried = [...attempts.entries()].filter(([, n]) => n >= 3);
  check(
    retried.length > 0,
    `operations were replayed past the blip (${retried.map(([k, n]) => `${k}×${n}`).join(", ") || "none"})`,
  );

  const toasts = await toastTexts(page);
  check(
    !toasts.some((t) => t.includes(FRIENDLY_TOAST) || t.includes(RAW_TOAST)),
    `no error toast after a 2-failure blip (saw: ${JSON.stringify(toasts)})`,
  );

  const bodyText = await page.evaluate(() => document.body.innerText.length);
  check(bodyText > 100, `page rendered content despite the blip (${bodyText} chars)`);
  await context.close();
}

// ---------------------------------------------------------------------------
// 2. Dead network: every GraphQL fetch aborts. Expect retries to be attempted
//    and then exactly ONE friendly toast — never the raw "[Network error]".
// ---------------------------------------------------------------------------
{
  const { context, page } = await newPage();
  const attempts = new Map();
  const seenToasts = [];
  await page.route(GRAPHQL, async (route) => {
    const name = opName(route.request());
    attempts.set(name, (attempts.get(name) ?? 0) + 1);
    await route.abort("internetdisconnected");
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Sample toasts while waiting (ant messages auto-dismiss after 5s).
  for (let i = 0; i < 20; i++) {
    await sleep(1_000);
    for (const t of await toastTexts(page)) {
      if (!seenToasts.includes(t)) seenToasts.push(t);
    }
  }

  const exhausted = [...attempts.entries()].filter(([, n]) => n >= 3);
  check(
    exhausted.length > 0,
    `dead network was retried before giving up (${[...attempts.entries()].map(([k, n]) => `${k}×${n}`).join(", ")})`,
  );
  const friendly = seenToasts.filter((t) => t.includes(FRIENDLY_TOAST));
  const raw = seenToasts.filter((t) => t.includes(RAW_TOAST));
  check(
    friendly.length === 1,
    `exactly one friendly toast (saw ${friendly.length}: ${JSON.stringify(seenToasts)})`,
  );
  check(raw.length === 0, "no raw [Network error] toast");
  await context.close();
}

// ---------------------------------------------------------------------------
// 3. Stale/failed chunk: abort the login route's lazy chunk once during SPA
//    navigation → router.onError should full-reload once and land on /login.
// ---------------------------------------------------------------------------
{
  const { context, page } = await newPage();
  await page.goto("/", { waitUntil: "networkidle" }).catch(() => {});

  let chunksAborted = 0;
  await page.route("**/assets/Login-*.js", async (route) => {
    if (chunksAborted === 0) {
      chunksAborted += 1;
      log(`aborting chunk once: ${route.request().url().split("/").pop()}`);
      await route.abort("internetdisconnected");
    } else {
      await route.continue();
    }
  });

  const reloads = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) reloads.push(frame.url());
  });

  // SPA-navigate via history so the router (not a fresh document) loads the
  // chunk — same path a user takes clicking a <router-link>.
  await page.evaluate(() => window.history.pushState({}, "", "/login"));
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate", { state: {} })));
  await sleep(6_000);

  check(chunksAborted === 1, `login chunk load was injured once (${chunksAborted})`);
  const onLogin = page.url().includes("/login");
  const hasForm = await page
    .locator('input[type="password"]')
    .first()
    .isVisible()
    .catch(() => false);
  check(
    onLogin && hasForm,
    `recovered onto /login with a rendered form (url=${page.url()}, reloads=${reloads.length})`,
  );
  check(reloads.length >= 1, "a full reload was performed to recover");

  const flag = await page.evaluate(() => sessionStorage.getItem("chunk-reload-attempted"));
  check(flag === null, "reload-loop guard flag was cleared after successful navigation");
  await context.close();
}

await browser.close();
if (failures) {
  console.error(`[net-check] ${failures} check(s) FAILED`);
  process.exit(1);
}
log("all checks passed");
