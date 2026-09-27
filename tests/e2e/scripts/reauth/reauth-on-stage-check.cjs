// Browser check: a login that ends while a stage is open (views/live/ReauthPrompt.vue).
// Covers genuinely expired tokens (re-signed with the e2e backend's own key by
// expire-token.sh), network loss during re-login, wrong password, "Later",
// reload, leaving the stage, two windows on one login, audience, cold load.
//
// Needs the disposable e2e stack (tests/e2e/env/e2e-backend-up.sh + vite-e2e.sh)
// and a stage authored by the setup project (tests/e2e/runtime.json).
//
//   node tests/e2e/scripts/reauth/reauth-on-stage-check.cjs
const { execFileSync } = require("child_process");
const path = require("path");
const { chromium } = require("@playwright/test");
const runtime = require("../../runtime.json");
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const STAGE = "/" + runtime.stageSlug;
const ADMIN = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const expire = (t) =>
  execFileSync(path.join(__dirname, "expire-token.sh"), { input: t }).toString().trim();
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok ? "" : "  " + JSON.stringify(detail)));
};
// Memory and the stored login age together in a real session, so both get the dead tokens.
const SET_DEAD = ({ a, r }) => {
  const b = JSON.parse(localStorage.getItem("upstage-auth"));
  b.token = a;
  b.refresh_token = r;
  localStorage.setItem("upstage-auth", JSON.stringify(b));
  window.__UPSTAGE_PINIA__.auth.setSession(a, r);
};
const PROMPT = '[data-testid="reauth-prompt"]';

async function loginUi(page) {
  await page.goto(BASE + "/login");
  await page.locator('input[name="username"]').first().fill(ADMIN);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login")),
    page.locator('button[type="submit"]').first().click(),
  ]);
}
async function openStage(page, url = STAGE) {
  await page.goto(BASE + url);
  await page.waitForFunction(() => window.__UPSTAGE_PINIA__?.stage?.model, null, {
    timeout: 60000,
  });
  await page.waitForTimeout(2500);
  await page
    .locator("section.cover-image")
    .click({ position: { x: 300, y: 300 }, timeout: 3000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
}
const state = (page) =>
  page.evaluate(() => {
    const p = window.__UPSTAGE_PINIA__;
    return {
      url: location.pathname + location.search,
      loggedIn: p.auth.loggedIn,
      deferred: p.auth.sessionEndDeferred,
      canPlay: p.stage.canPlay,
      status: p.stage.status,
      token: p.auth.token,
    };
  });
const tokens = (page) =>
  page.evaluate(() => ({
    a: window.__UPSTAGE_PINIA__.auth.token,
    r: window.__UPSTAGE_PINIA__.auth.refresh_token,
  }));
const startRequest = (page, key = "__req") =>
  page.evaluate((key) => {
    window[key] = { state: "pending" };
    window.__UPSTAGE_PINIA__.user.checkIsAdmin().then(
      (v) => (window[key] = { state: "resolved", value: v }),
      (e) => (window[key] = { state: "rejected", error: String(e?.message ?? e) }),
    );
  }, key);
const track = (page) => {
  const navs = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navs.push(f.url().replace(BASE, ""));
  });
  return navs;
};
// Put genuinely expired tokens into the RUNNING session, as after a long sleep.
async function expireSession(page) {
  const t = await tokens(page);
  const dead = { a: expire(t.a), r: expire(t.r) };
  await page.evaluate(SET_DEAD, dead);
  return dead;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const vp = { viewport: { width: 1400, height: 900 } };

  // ---------- 1. token genuinely expired on a running stage ----------
  {
    const ctx = await browser.newContext(vp);
    const page = await ctx.newPage();
    await loginUi(page);
    await openStage(page);
    const navs = track(page);
    await page.evaluate(() => {
      const p = window.__UPSTAGE_PINIA__;
      window.__statusLog = [p.stage.status];
      setInterval(() => {
        const s = p.stage.status;
        if (s !== window.__statusLog.at(-1)) window.__statusLog.push(s);
      }, 50);
    });
    const dead = await expireSession(page);
    const direct = await page.evaluate(async (a) => {
      const r = await fetch("/api/studio_graphql", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: "Bearer " + a },
        body: JSON.stringify({ query: "{ currentUser { username } }" }),
      });
      return (await r.json()).errors?.[0]?.message;
    }, dead.a);
    check(
      "1a server calls the token expired (genuine, signed)",
      direct === "Signature has expired",
      direct,
    );
    await page
      .locator(PROMPT)
      .waitFor({ timeout: 8000 })
      .catch(() => {});
    let s = await state(page);
    check(
      "1b prompt appears, stage untouched",
      (await page.locator(PROMPT).isVisible()) &&
        s.deferred &&
        s.loggedIn &&
        s.canPlay &&
        s.status === "LIVE" &&
        s.url === STAGE,
      s,
    );
    await startRequest(page);
    await page.waitForTimeout(2500);
    check(
      "1c a request that needs the login waits",
      (await page.evaluate(() => window.__req.state)) === "pending",
      await page.evaluate(() => window.__req),
    );

    // ---------- 2. re-login while the network is down ----------
    await page.route("**/studio_graphql", (route) => route.abort("internetdisconnected"));
    await page.locator(PROMPT + ' input[name="password"]').fill(PASSWORD);
    await page.locator('[data-testid="reauth-submit"]').click();
    await page
      .locator('[data-testid="reauth-error"]')
      .waitFor({ timeout: 60000 })
      .catch(() => {});
    s = await state(page);
    check(
      "2a network down: error shown in the prompt, nothing else changes",
      (await page.locator('[data-testid="reauth-error"]').isVisible()) &&
        s.deferred &&
        s.url === STAGE &&
        s.token === dead.a,
      {
        s: { ...s, token: undefined },
        err: await page
          .locator('[data-testid="reauth-error"]')
          .innerText()
          .catch(() => null),
      },
    );
    check(
      "2b the waiting request is still waiting",
      (await page.evaluate(() => window.__req.state)) === "pending",
      await page.evaluate(() => window.__req),
    );
    await page.unroute("**/studio_graphql");

    // wrong password, then empty-ish, then right
    await page.locator(PROMPT + ' input[name="password"]').fill("not-the-password");
    await page.locator('[data-testid="reauth-submit"]').click();
    await page
      .waitForFunction(
        () =>
          /Incorrect/i.test(
            document.querySelector('[data-testid="reauth-error"]')?.textContent ?? "",
          ),
        null,
        { timeout: 15000 },
      )
      .catch(() => {});
    s = await state(page);
    check(
      "2c wrong password: refused, session unchanged",
      /Incorrect/i.test(await page.locator('[data-testid="reauth-error"]').innerText()) &&
        s.deferred &&
        s.token === dead.a,
      { ...s, token: undefined },
    );
    await page.locator(PROMPT + ' input[name="password"]').fill(PASSWORD);
    await page.locator('[data-testid="reauth-submit"]').click();
    await page
      .locator(PROMPT)
      .waitFor({ state: "detached", timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    s = await state(page);
    const req = await page.evaluate(() => window.__req);
    check(
      "2d right password: new token in the running session",
      !s.deferred && s.loggedIn && s.token !== dead.a && s.url === STAGE && s.canPlay,
      { ...s, token: undefined },
    );
    check(
      "2e the waiting request was replayed and succeeded",
      req.state === "resolved" && req.value === true,
      req,
    );
    const stored = await page.evaluate(
      () => JSON.parse(localStorage.getItem("upstage-auth")).token,
    );
    check("2f stored login is the new one", stored === s.token, null);
    check(
      "2g stage never reconnected or navigated",
      (await page.evaluate(() => window.__statusLog)).join() === "LIVE" && navs.length === 0,
      { log: await page.evaluate(() => window.__statusLog), navs },
    );
    // the new token keeps being renewed: force a renewal now
    const renewed = await page.evaluate(async () => {
      const p = window.__UPSTAGE_PINIA__;
      const before = p.auth.token;
      const t = await p.auth.fetchRefreshToken();
      return { changed: !!t && t !== before, deferred: p.auth.sessionEndDeferred };
    });
    check(
      "2h the new login renews normally afterwards",
      renewed.changed && !renewed.deferred,
      renewed,
    );

    // ---------- 3. server unreachable at renewal time ----------
    await page.route("**/studio_graphql", (route) => route.abort("internetdisconnected"));
    const out3 = await page.evaluate(async () => {
      const p = window.__UPSTAGE_PINIA__;
      await p.auth.fetchRefreshToken();
      return { deferred: p.auth.sessionEndDeferred, loggedIn: p.auth.loggedIn };
    });
    await page.unroute("**/studio_graphql");
    check(
      "3 server unreachable: no prompt, login kept",
      !out3.deferred && out3.loggedIn && !(await page.locator(PROMPT).isVisible()),
      out3,
    );

    // ---------- 4. "Later", then reload the stage ----------
    await expireSession(page);
    await page.locator(PROMPT).waitFor({ timeout: 8000 });
    await startRequest(page, "__req4");
    await page.waitForTimeout(800);
    await page.locator('[data-testid="reauth-later"]').click();
    await page.waitForTimeout(1500);
    const r4 = await page.evaluate(() => window.__req4);
    s = await state(page);
    check(
      "4a Later: waiting request ends (not hanging), stage still running",
      r4.state !== "pending" &&
        s.deferred &&
        s.canPlay &&
        s.status === "LIVE" &&
        (await page.locator('[data-testid="reauth-reopen"]').isVisible()),
      { r4, s: { ...s, token: undefined } },
    );
    await page.reload();
    await page.waitForFunction(() => window.__UPSTAGE_PINIA__?.stage?.model, null, {
      timeout: 60000,
    });
    await page.waitForTimeout(2000);
    s = await state(page);
    check(
      "4b reload with an ended login: stage loads, dead login gone, no login-page bounce",
      s.url === STAGE && !s.loggedIn && !s.deferred,
      { ...s, token: undefined },
    );
    await ctx.close();
  }

  // ---------- 5. leaving the stage after "Later" ----------
  {
    const ctx = await browser.newContext(vp);
    const page = await ctx.newPage();
    await loginUi(page);
    await openStage(page);
    await expireSession(page);
    await page.locator(PROMPT).waitFor({ timeout: 8000 });
    await page.locator('[data-testid="reauth-later"]').click();
    await page.evaluate(() =>
      document
        .querySelector("#app")
        .__vue_app__.config.globalProperties.$router.push("/media?page=2"),
    );
    await page
      .waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(800);
    const url = await page.evaluate(() => location.pathname + location.search);
    check(
      "5 leaving the stage completes the logout, with the way back",
      url === "/login?redirect=%2Fmedia%3Fpage%3D2" &&
        (await page.locator("body").innerText()).includes("session has expired"),
      url,
    );
    await ctx.close();
  }

  // ---------- 6. two windows: stage + popped-out chat ----------
  {
    const ctx = await browser.newContext(vp);
    const stage = await ctx.newPage();
    await loginUi(stage);
    await openStage(stage);
    const chat = await ctx.newPage();
    await chat.goto(BASE + "/chat" + STAGE);
    await chat.waitForFunction(() => window.__UPSTAGE_PINIA__?.stage?.model, null, {
      timeout: 60000,
    });
    await chat.waitForTimeout(2000);
    const chatNavs = track(chat);
    // renewal race: both windows renew at the same moment with the same refresh token
    const [ra, rb] = await Promise.all(
      [stage, chat].map((p) =>
        p.evaluate(async () => {
          const s = window.__UPSTAGE_PINIA__.auth;
          await s.fetchRefreshToken();
          return { deferred: s.sessionEndDeferred, loggedIn: s.loggedIn };
        }),
      ),
    );
    await stage.waitForTimeout(2500);
    const ta = await tokens(stage),
      tb = await tokens(chat);
    const okTok = await stage.evaluate(async (a) => {
      const r = await fetch("/api/studio_graphql", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: "Bearer " + a },
        body: JSON.stringify({ query: "{ currentUser { username } }" }),
      });
      return (await r.json()).data?.currentUser?.username;
    }, ta.a);
    check(
      "6a renewal race between two windows ends no session",
      !ra.deferred &&
        !rb.deferred &&
        ra.loggedIn &&
        rb.loggedIn &&
        !(await stage.locator(PROMPT).isVisible()) &&
        !(await chat.locator(PROMPT).isVisible()),
      { ra, rb },
    );
    check(
      "6b both windows hold the same working login",
      ta.a === tb.a && ta.r === tb.r && okTok === ADMIN,
      { same: ta.a === tb.a, okTok },
    );
    // the login really ends in both windows
    const t = await tokens(stage);
    const dead = { a: expire(t.a), r: expire(t.r) };
    await stage.evaluate(SET_DEAD, dead);
    await chat.evaluate(SET_DEAD, dead);
    await stage
      .locator(PROMPT)
      .waitFor({ timeout: 8000 })
      .catch(() => {});
    await chat
      .locator(PROMPT)
      .waitFor({ timeout: 8000 })
      .catch(() => {});
    check(
      "6c both windows ask, neither navigates",
      (await stage.locator(PROMPT).isVisible()) &&
        (await chat.locator(PROMPT).isVisible()) &&
        chatNavs.length === 0,
      { chatNavs },
    );
    await startRequest(chat, "__reqChat");
    await chat.waitForTimeout(1000);
    await stage.locator(PROMPT + ' input[name="password"]').fill(PASSWORD);
    await stage.locator('[data-testid="reauth-submit"]').click();
    await stage
      .locator(PROMPT)
      .waitFor({ state: "detached", timeout: 15000 })
      .catch(() => {});
    await chat
      .locator(PROMPT)
      .waitFor({ state: "detached", timeout: 8000 })
      .catch(() => {});
    await chat.waitForTimeout(1000);
    const sc = await state(chat),
      rc = await chat.evaluate(() => window.__reqChat);
    check(
      "6d logging in on the stage also restores the chat window",
      !sc.deferred &&
        sc.token === (await tokens(stage)).a &&
        !(await chat.locator(PROMPT).isVisible()) &&
        chatNavs.length === 0,
      { ...sc, token: undefined },
    );
    check(
      "6e the chat window's waiting request was replayed",
      rc.state === "resolved" && rc.value === true,
      rc,
    );
    // closing the chat window must not take the stage's login with it
    await chat.close();
    await stage.waitForTimeout(800);
    const ss = await state(stage);
    const still = await stage.evaluate(() =>
      Boolean(JSON.parse(localStorage.getItem("upstage-auth") ?? "{}").token),
    );
    check(
      "6f closing the chat window leaves the stage's login alone",
      ss.loggedIn && !ss.deferred && still,
      { ...ss, token: undefined },
    );
    await ctx.close();
  }

  // ---------- 7. audience (never logged in) ----------
  {
    const ctx = await browser.newContext(vp);
    const page = await ctx.newPage();
    await openStage(page);
    const s = await state(page);
    check(
      "7 audience is never asked to log in again",
      !s.loggedIn &&
        !s.deferred &&
        !(await page.locator(PROMPT).isVisible()) &&
        !(await page.locator('[data-testid="reauth-reopen"]').isVisible()),
      { ...s, token: undefined },
    );
    await ctx.close();
  }

  // ---------- 8. cold load of a stage with an expired login ----------
  {
    const ctx = await browser.newContext(vp);
    const page = await ctx.newPage();
    await loginUi(page);
    const blob = await page.evaluate(() => JSON.parse(localStorage.getItem("upstage-auth")));
    const dead = { a: expire(blob.token), r: expire(blob.refresh_token) };
    await page.evaluate(({ a, r }) => {
      const b = JSON.parse(localStorage.getItem("upstage-auth"));
      b.token = a;
      b.refresh_token = r;
      localStorage.setItem("upstage-auth", JSON.stringify(b));
    }, dead);
    await page.goto(BASE + STAGE);
    await page.waitForTimeout(3000);
    const url = await page.evaluate(() => location.pathname + location.search);
    check(
      "8a stage opened with an expired login: login page first",
      url === "/login?redirect=" + encodeURIComponent(STAGE),
      url,
    );
    await page.locator('input[name="username"]').first().fill(ADMIN);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith("/login")),
      page.locator('button[type="submit"]').first().click(),
    ]);
    await page.waitForFunction(() => window.__UPSTAGE_PINIA__?.stage?.model, null, {
      timeout: 60000,
    });
    const s = await state(page);
    check("8b ...then back on the stage as a player", s.url === STAGE && s.loggedIn && s.canPlay, {
      ...s,
      token: undefined,
    });
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("PROBE ERROR", e.message.slice(0, 1500));
  process.exit(2);
});
