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
        authorization: `Bearer ${token}`,
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
    // We dispatch `stage/shapeObject` directly rather than driving a pointer
    // drag through the DOM. With liveAction: true on an already-published
    // object this emits BOARD_ACTIONS.MOVE_TO over MQTT for every observer —
    // exactly what a real drag does on dragEnd. Avoids the fragility of
    // pointer-timing and works regardless of viewport/zoom. (The DOM path is
    // available via LiveStagePage.moveObjectByName for tests that specifically
    // want to exercise the pointer/drag code.)
    await moveAvatar({
      seat,
      mediaName: mediaRef.name,
      to: beat.to ?? { x: 500, y: 300 },
    });
    return;
  }

  if (beat.kind === "speak" || beat.kind === "shout" || beat.kind === "think") {
    if (!beat.line) throw new Error(`${tag}: missing line`);
    // Players speak in-world: their line is the avatar's voice (TTS via
    // meSpeak) and a transient bubble over the avatar (Topping.vue), and is
    // *not* an OOC chat-panel message. We dispatch `stage/speakAsAvatar`
    // (TOPICS.BOARD/SPEAK only — no TOPICS.CHAT) instead of typing into the
    // chat input. The chat panel stays reserved for audience text and the
    // `-` prefix in `stage/sendChat`.
    await speakAsAvatar({ seat, message: beat.line, behavior: beat.kind });

    const mediaRef = runtime.mediaByPersona[beat.speaker];
    if (mediaRef) {
      // The bubble being visible on the *admin's* page proves the SPEAK MQTT
      // message round-tripped — and SET_OBJECT_SPEAK calls avatarSpeak() on
      // every observing client (including the speaker), so the bubble is also
      // implicit proof that TTS was fired. The bubble is ephemeral: it
      // auto-clears after 1s + 1s/word (SET_OBJECT_SPEAK timer), and Topping's
      // BUBBLE_TIMEOUT is 5s — so don't dawdle between dispatch and assert.
      await expect(
        adminLive.speechBubbleFor(mediaRef.name),
      ).toBeVisible({ timeout: 8_000 });

      // Negative assertion: player speech must NOT pollute the public chat
      // log. We sample the first few words of the line; for shouts, sendChat
      // would have uppercased — `speakAsAvatar` does the same for `behavior`
      // semantics, so we check both forms to be safe.
      const expectedPrefix = beat.line.split(/\s+/).slice(0, 4).join(" ");
      const needles = beat.kind === "shout"
        ? [expectedPrefix, expectedPrefix.toUpperCase()]
        : [expectedPrefix];
      for (const needle of needles) {
        await expect(
          adminLive.chatLogEntryFor(mediaRef.name, needle),
        ).toHaveCount(0, { timeout: 1_000 });
      }
    }
    return;
  }
}

/**
 * Drive in-world avatar speech (bubble + meSpeak TTS) from the speaker's seat
 * by dispatching `stage/speakAsAvatar` directly via the dev-store hook. This
 * intentionally skips the chat input / `stage/sendChat` path so the line does
 * NOT appear in the public chat log — matching how player speech behaves in
 * the real app (in-world performance, not OOC chat).
 *
 * Throws if the seat has no held avatar or `canPlay` is false (rather than
 * silently no-opping like the underlying action) so test failures point at the
 * real cause: the speaker isn't actually on stage / hasn't been granted
 * player permissions.
 */
async function speakAsAvatar({
  seat,
  message,
  behavior,
}: {
  seat: CastSeat;
  message: string;
  behavior: "speak" | "shout" | "think";
}): Promise<void> {
  await seat.page.evaluate(
    async ({ message, behavior }) => {
      type DevStore = {
        dispatch: (type: string, payload?: unknown) => Promise<unknown>;
        getters: Record<string, unknown>;
      };
      const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
      if (!store) {
        throw new Error("Vuex store not exposed (__UPSTAGE_STORE__).");
      }
      const avatar = store.getters["stage/currentAvatar"];
      if (!avatar) {
        throw new Error(
          "speakAsAvatar: no currentAvatar held — the speaker hasn't entered or `enter` did not publish.",
        );
      }
      const canPlay = store.getters["stage/canPlay"];
      if (!canPlay) {
        throw new Error(
          "speakAsAvatar: canPlay=false on this seat — backend permission resolution did not grant `player`.",
        );
      }
      await store.dispatch("stage/speakAsAvatar", { message, behavior });
    },
    { message, behavior },
  );
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

async function moveAvatar({
  seat,
  mediaName,
  to,
}: {
  seat: CastSeat;
  mediaName: string;
  to: { x: number; y: number };
}): Promise<void> {
  await seat.page.evaluate(
    async ({ mediaName, to }) => {
      type StageSlice = {
        board: { objects: Array<Record<string, unknown> & { id: string; name?: string; published?: boolean }> };
      };
      type DevStore = {
        dispatch: (type: string, payload?: unknown) => Promise<unknown>;
        state: { stage: StageSlice };
      };

      const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
      if (!store) {
        throw new Error("Vuex store not exposed (__UPSTAGE_STORE__).");
      }

      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      // Object placement is async (MQTT round-trip via shapeObject in placeAvatar);
      // a follow-up move beat may run before the seat's local board state has
      // settled. Poll briefly so we don't race the placement.
      let target: (Record<string, unknown> & { id: string; published?: boolean }) | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        target = store.state.stage.board.objects.find(
          (o) => o.name === mediaName,
        );
        if (target) break;
        await sleep(150);
      }
      if (!target) {
        throw new Error(
          `move: object name=${mediaName} not in board.objects on this seat`,
        );
      }

      // shapeObject with liveAction: true emits BOARD_ACTIONS.MOVE_TO when the
      // object is already published (placeAvatar publishes on enter), or
      // PLACE_OBJECT_ON_STAGE if not — either way observers see the new x/y.
      await store.dispatch("stage/shapeObject", {
        ...target,
        x: to.x,
        y: to.y,
        liveAction: true,
        published: target.published ?? true,
      });
    },
    { mediaName, to },
  );
}
