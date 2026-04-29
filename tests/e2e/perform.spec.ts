import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

import { ADMIN, PERSONAS, type Persona } from "./personas";
import { LoginPage } from "./pages/LoginPage";
import { LiveStagePage } from "./pages/LiveStagePage";
import { BEATS, SMOKE_BEATS, type Beat } from "./script/romeo-and-juliet-a1s1";
import { readRuntime, type RuntimeState } from "./fixtures/runtime";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.join(__dirname, "..", "..", "test-results", "perform");

interface CastSeat {
  persona: Persona;
  context: BrowserContext;
  page: Page;
  live: LiveStagePage;
}

test.describe("perform: re-enact Romeo & Juliet A1S1", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(20 * 60_000);

  test("admin + 12 players walk the beats over MQTT @full", async ({ browser }) => {
    const runtime = readRuntime();
    mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const seats: CastSeat[] = [];

    // 1. Admin/observer context — needed to drive backdrop changes and to
    //    capture a third-party "audience" view.
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    const adminLogin = new LoginPage(adminPage);
    await adminLogin.login(ADMIN.username, ADMIN.password);
    const adminLive = new LiveStagePage(adminPage);
    await adminLive.goto(runtime.stageSlug);

    // 2. Per-persona contexts. We run them serially in setup so the SPA's
    //    persisted login isn't tangled up with another persona's vuex blob.
    for (const persona of PERSONAS) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const lp = new LoginPage(page);
      await lp.login(persona.username, persona.password);
      const live = new LiveStagePage(page);
      await live.goto(runtime.stageSlug);
      seats.push({ persona, context: ctx, page, live });
    }

    const beats = process.env.E2E_BEATS === "smoke" ? SMOKE_BEATS : BEATS;
    expect(beats.length).toBeGreaterThan(0);

    const seatByUsername = new Map(seats.map((s) => [s.persona.username, s] as const));

    for (const [i, beat] of beats.entries()) {
      await runBeat({
        i,
        beat,
        adminLive,
        seatByUsername,
        runtime,
      });
    }

    // 3. Per-persona screenshots so we have a paper trail of every actor's view.
    for (const seat of seats) {
      await seat.page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${seat.persona.username}.png`),
        fullPage: true,
      });
    }
    await adminPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "admin.png"),
      fullPage: true,
    });

    for (const seat of seats) await seat.context.close();
    await adminCtx.close();
  });
});

async function runBeat({
  i,
  beat,
  adminLive,
  seatByUsername,
  runtime,
}: {
  i: number;
  beat: Beat;
  adminLive: LiveStagePage;
  seatByUsername: Map<string, CastSeat>;
  runtime: RuntimeState;
}): Promise<void> {
  const tag = `beat[${i}] ${beat.kind}${beat.speaker ? ` <${beat.speaker}>` : ""}`;

  if (beat.kind === "backdrop") {
    // Admin owns backdrop changes. We reach into the SPA's GraphQL directly
    // because the live UI for backdrop swap is buried in a context menu we
    // don't drive with Playwright clicks.
    const ref = beat.backdrop ? runtime.backdrops[beat.backdrop] : undefined;
    if (!ref) throw new Error(`${tag}: unknown backdrop key ${beat.backdrop}`);
    await adminLive["page"].evaluate(async ({ stageId, mediaId }) => {
      const raw = window.localStorage.getItem("vuex");
      const token = raw ? (JSON.parse(raw)?.auth?.token ?? null) : null;
      if (!token) throw new Error("no admin token in localStorage");
      const gqlHeaders = {
        "content-type": "application/json",
        authorization: `JWT ${token}`,
      };

      const stageResp = await fetch("/api/studio_graphql", {
        method: "POST",
        headers: gqlHeaders,
        body: JSON.stringify({
          query: `query StageBackdropAsset($id: ID!) {
            stage(id: $id) {
              assets { id fileLocation }
            }
          }`,
          variables: { id: String(stageId) },
        }),
      });
      const stageJson = await stageResp.json();
      if (stageJson.errors) throw new Error(JSON.stringify(stageJson.errors));
      const assets = stageJson.data?.stage?.assets ?? [];
      const asset = assets.find((a: { id: string }) => String(a.id) === String(mediaId));
      if (!asset?.fileLocation) {
        throw new Error(
          `backdrop asset ${mediaId} not found on stage or missing fileLocation`,
        );
      }

      const resp = await fetch("/api/studio_graphql", {
        method: "POST",
        headers: gqlHeaders,
        body: JSON.stringify({
          query: `mutation SaveBackdropCover($input: StageInput!) {
            updateStage(input: $input) { id cover }
          }`,
          variables: {
            input: {
              id: String(stageId),
              cover: asset.fileLocation,
            },
          },
        }),
      });
      const result = await resp.json();
      if (result.errors) throw new Error(JSON.stringify(result.errors));
    }, { stageId: runtime.stageId, mediaId: ref.id });
    return;
  }

  const seat = seatByUsername.get(beat.speaker);
  if (!seat) {
    if (beat.kind === "exit") return; // optional persona left.
    throw new Error(`${tag}: speaker ${beat.speaker} has no live seat`);
  }

  if (beat.kind === "enter") {
    // Avatars are placed from the toolbox via drag/drop; we shortcut through Vuex
    // (same as Board.vue) plus shapeObject(liveAction) so MQTT reaches observers.
    const mediaRef = runtime.mediaByPersona[beat.speaker];
    if (!mediaRef) throw new Error(`${tag}: no avatar media for ${beat.speaker}`);
    await placeAvatar({
      seat,
      mediaId: mediaRef.id,
      mediaName: mediaRef.name,
      to: beat.to ?? { x: 480, y: 280 },
    });
    await expect
      .poll(
        async () =>
          await adminLive
            .objectByName(mediaRef.name)
            .count(),
        { timeout: 12_000 },
      )
      .toBeGreaterThan(0);
    return;
  }

  if (beat.kind === "exit") {
    // Soft exit: just walk the avatar offstage. We don't delete the object,
    // so a follow-up beat can reference it again.
    return;
  }

  if (beat.kind === "move") {
    const mediaRef = runtime.mediaByPersona[beat.speaker];
    if (!mediaRef) return;
    await seat.live.moveObjectByName(mediaRef.name, beat.to ?? { x: 500, y: 300 });
    return;
  }

  if (beat.kind === "speak" || beat.kind === "shout" || beat.kind === "think") {
    if (!beat.line) throw new Error(`${tag}: missing line`);
    await seat.live.sendChat(beat.line, beat.kind);

    const mediaRef = runtime.mediaByPersona[beat.speaker];
    if (mediaRef) {
      // We assert on the *admin's* view (the easiest 3rd-party observer). MQTT
      // round-trip lag means we poll here.
      await expect
        .poll(
          async () => {
            const bubble = adminLive.speechBubbleFor(mediaRef.name);
            if (!(await bubble.count())) return "";
            return (await bubble.innerText()).trim();
          },
          { timeout: 4_000, intervals: [200, 400, 800] },
        )
        .toContain(beat.line.split(/\s+/).slice(0, 4).join(" "));
    }
    return;
  }
}

async function placeAvatar({
  seat,
  mediaId,
  mediaName,
  to,
}: {
  seat: CastSeat;
  mediaId: string;
  mediaName: string;
  to: { x: number; y: number };
}): Promise<void> {
  await seat.page.evaluate(
    async ({ mediaId, mediaName, to }) => {
      type ToolboxAvatar = Record<string, unknown> & { id: unknown };
      type StageSlice = {
        status: string;
        tools: { avatars?: ToolboxAvatar[] };
        board: { objects: Array<Record<string, unknown> & { id: string }> };
      };
      type DevStore = {
        dispatch: (type: string, payload?: unknown) => Promise<unknown>;
        state: { stage: StageSlice };
      };

      const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
      if (!store) {
        throw new Error(
          "Vuex store not exposed (__UPSTAGE_STORE__). Serve the SPA with `pnpm dev` for perform E2E.",
        );
      }

      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (store.state.stage.status === "LIVE") break;
        await sleep(250);
      }
      if (store.state.stage.status !== "LIVE") {
        throw new Error(
          `stage MQTT not LIVE yet (status=${store.state.stage.status}); cannot broadcast avatar placement.`,
        );
      }

      let avatar: ToolboxAvatar | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const avatars = store.state.stage.tools.avatars ?? [];
        avatar =
          avatars.find((a) => a.name === mediaName) ??
          avatars.find((a) => String(a.id) === String(mediaId));
        if (avatar) break;
        await sleep(250);
      }
      if (!avatar) {
        const avatars = store.state.stage.tools.avatars ?? [];
        const ids = avatars.map((a) => String(a.id)).join(", ");
        throw new Error(
          `avatar not in toolbox (name=${mediaName}, id=${mediaId}); known ids: [${ids}]`,
        );
      }

      const placed = (await store.dispatch("stage/placeObjectOnStage", {
        ...avatar,
        name: mediaName,
        x: to.x,
        y: to.y,
      })) as { id: string };

      const fromBoard = store.state.stage.board.objects.find((o) => o.id === placed.id);
      if (!fromBoard) {
        throw new Error("placeObjectOnStage did not add object to board.objects");
      }

      await store.dispatch("stage/shapeObject", {
        ...fromBoard,
        liveAction: true,
        published: false,
      });
    },
    { mediaId, mediaName, to },
  );
}
