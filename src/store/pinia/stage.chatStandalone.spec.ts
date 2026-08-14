// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Standalone /chat/:url window regression tests (July 2026 rehearsal bug).
 *
 * `window.open()` copies the opener's sessionStorage into the pop-out
 * (HTML spec), so the popped-out chat used to read the SAME
 * `upstage:stage:tabSessionId` as the main stage tab and impersonate it on
 * the presence wire. Closing the pop-out published COUNTER
 * `{id: <main tab id>, leaving: true}`, every client evicted the MAIN tab
 * from its roster, and `pruneOrphanJitsiTilesFromOldSessions` destroyed that
 * performer's live jitsi tiles for everyone (with a broadcast DESTROY, so
 * the streams vanished stage-wide until a reload).
 *
 * These tests pin the fix:
 *   * standalone chat windows mint a CHAT-scoped session id and join as
 *     audience (isPlayer: false);
 *   * pop-outs with a window.opener skip presence entirely;
 *   * the orphan-tile prune ignores this tab's own session id, applies a
 *     grace period before destroying, and never runs in chat windows.
 */

const { sendMessage, sendMessageSync } = vi.hoisted(() => ({
  sendMessage: vi.fn((..._args: unknown[]) => Promise.resolve()),
  sendMessageSync: vi.fn((..._args: unknown[]) => undefined),
}));
vi.mock("@services/mqtt", () => ({
  default: () => ({
    connect: vi.fn(),
    whenConnected: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => Promise.resolve()),
    sendMessage,
    sendMessageSync,
    receiveMessage: vi.fn(),
  }),
}));
vi.mock("@services/speech", () => ({
  avatarSpeak: vi.fn(),
  stopSpeaking: vi.fn(),
}));

import { useStageStore } from "./stage";
import { BOARD_ACTIONS, TOPICS } from "@utils/constants";

type StageStore = ReturnType<typeof useStageStore>;

const STAGE_KEY = "upstage:stage:tabSessionId";
const CHAT_KEY = "upstage:chat:tabSessionId";

/** Minimal model making `canPlay` truthy without touching GraphQL. */
const playerModel = { permission: "player", attributes: [] } as never;

const counterCalls = () =>
  sendMessage.mock.calls.filter(([topic]) => topic === TOPICS.COUNTER) as unknown as Array<
    [string, { id: string; isPlayer?: boolean; leaving?: boolean }]
  >;

const destroyCalls = () =>
  sendMessage.mock.calls.filter(
    ([topic, payload]) =>
      topic === TOPICS.BOARD && (payload as { type?: string })?.type === BOARD_ACTIONS.DESTROY,
  );

const seedJitsiTile = (store: StageStore, id: string, hostId: string) => {
  store.PUSH_OBJECT({
    id,
    name: id,
    type: "jitsi",
    hostId,
    published: true,
    x: 10,
    y: 10,
    w: 100,
    h: 100,
  } as never);
};

const hasObject = (store: StageStore, id: string) =>
  store.board.objects.some((o: { id: unknown }) => String(o.id) === id);

let store: StageStore;
beforeEach(() => {
  setActivePinia(createPinia());
  store = useStageStore();
  sendMessage.mockClear();
  sendMessageSync.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("standalone chat session identity", () => {
  it("mints a chat-scoped session id, never the opener's stage tab id", async () => {
    // Simulate window.open's sessionStorage copy: the pop-out arrives with
    // the opener stage tab's id already present under the stage key.
    window.sessionStorage.setItem(STAGE_KEY, "main-stage-tab-id");
    store.SET_MODEL(playerModel);
    store.setStandaloneChatMode({ suppressPresence: false });

    await store.joinStage();

    expect(store.session).not.toBeNull();
    expect(store.session).not.toBe("main-stage-tab-id");
    expect(window.sessionStorage.getItem(CHAT_KEY)).toBe(store.session);
    // The opener's id is untouched.
    expect(window.sessionStorage.getItem(STAGE_KEY)).toBe("main-stage-tab-id");
  });

  it("joins the roster as audience even when the user could play", async () => {
    store.SET_MODEL(playerModel);
    store.setStandaloneChatMode({ suppressPresence: false });

    await store.joinStage();

    const published = counterCalls();
    expect(published.length).toBe(1);
    expect(published[0][1].isPlayer).toBe(false);
  });

  it("pop-outs with an opener publish no presence at all, in or out", async () => {
    store.SET_MODEL(playerModel);
    store.setStandaloneChatMode({ suppressPresence: true });
    store.SET_SUBSCRIBE_STATUS(true);

    await store.joinStage();
    // A session id IS minted (chat messages use it for "you" attribution)…
    expect(store.session).not.toBeNull();
    expect(window.sessionStorage.getItem(CHAT_KEY)).toBe(store.session);
    // …but nothing goes on the presence wire.
    expect(counterCalls().length).toBe(0);

    store.disconnectSync();
    // No leave message and no statistics decrement on the way out.
    expect(sendMessageSync).not.toHaveBeenCalled();
  });
});

describe("chat position toggle vs free-drag placement", () => {
  it("SET_CHAT_POSITION clears the per-client drag offset so the toggle wins", () => {
    store.setPublicChatPosition({ x: 123, y: 456 });
    expect(store.publicChatPosition).toEqual({ x: 123, y: 456 });

    store.SET_CHAT_POSITION("left");

    expect(store.chatPosition).toBe("left");
    // Without this the dragged panel ignored the broadcast toggle and only
    // remounted in place (disappear/reappear, no movement).
    expect(store.publicChatPosition).toBeNull();
  });
});

describe("pruneOrphanJitsiTilesFromOldSessions hardening", () => {
  it("never deletes tiles hosted by this tab's own session", async () => {
    vi.useFakeTimers();
    store.SET_MODEL(playerModel);
    await store.joinStage();
    const ownId = String(store.session);
    seedJitsiTile(store, "own-tile", ownId);

    // A stray leave for our own id (the pre-fix pop-out close) evicts our
    // roster row; later counter traffic used to prune our own tile.
    store.UPDATE_SESSIONS_COUNTER({ id: ownId, leaving: true, at: Date.now() });
    store.UPDATE_SESSIONS_COUNTER({ id: "someone-else", isPlayer: true, at: Date.now() });
    vi.advanceTimersByTime(120_000);
    store.UPDATE_SESSIONS_COUNTER({ id: "someone-else", isPlayer: true, at: Date.now() });

    expect(hasObject(store, "own-tile")).toBe(true);
    expect(destroyCalls().length).toBe(0);
  });

  it("keeps a remote tile through a transient roster gap, prunes only after the grace period", async () => {
    vi.useFakeTimers();
    store.SET_MODEL(playerModel);
    await store.joinStage();
    seedJitsiTile(store, "remote-tile", "remote-host");

    store.UPDATE_SESSIONS_COUNTER({ id: "remote-host", isPlayer: true, at: Date.now() });
    expect(hasObject(store, "remote-tile")).toBe(true);

    // Publisher row leaves; within the grace period the tile must survive.
    store.UPDATE_SESSIONS_COUNTER({ id: "remote-host", leaving: true, at: Date.now() });
    expect(hasObject(store, "remote-tile")).toBe(true);
    vi.advanceTimersByTime(30_000);
    store.UPDATE_SESSIONS_COUNTER({ id: "bystander", isPlayer: true, at: Date.now() });
    expect(hasObject(store, "remote-tile")).toBe(true);

    // Continuously absent past the grace period → pruned + DESTROY broadcast.
    vi.advanceTimersByTime(91_000);
    store.UPDATE_SESSIONS_COUNTER({ id: "bystander", isPlayer: true, at: Date.now() });
    expect(hasObject(store, "remote-tile")).toBe(false);
    expect(destroyCalls().length).toBe(1);
  });

  it("a returning publisher resets the grace clock", async () => {
    vi.useFakeTimers();
    store.SET_MODEL(playerModel);
    await store.joinStage();
    seedJitsiTile(store, "remote-tile", "remote-host");

    store.UPDATE_SESSIONS_COUNTER({ id: "remote-host", leaving: true, at: Date.now() });
    vi.advanceTimersByTime(60_000);
    // Publisher reappears (heartbeat) before the grace period elapsed.
    store.UPDATE_SESSIONS_COUNTER({ id: "remote-host", isPlayer: true, at: Date.now() });
    vi.advanceTimersByTime(60_000);
    store.UPDATE_SESSIONS_COUNTER({ id: "remote-host", isPlayer: true, at: Date.now() });

    expect(hasObject(store, "remote-tile")).toBe(true);
    expect(destroyCalls().length).toBe(0);
  });

  it("standalone chat windows never prune board tiles", async () => {
    vi.useFakeTimers();
    store.SET_MODEL(playerModel);
    store.setStandaloneChatMode({ suppressPresence: false });
    await store.joinStage();
    seedJitsiTile(store, "remote-tile", "performer-host-not-in-roster");

    store.UPDATE_SESSIONS_COUNTER({ id: "phone-viewer", at: Date.now() });
    vi.advanceTimersByTime(300_000);
    store.UPDATE_SESSIONS_COUNTER({ id: "phone-viewer", at: Date.now() });

    expect(hasObject(store, "remote-tile")).toBe(true);
    expect(destroyCalls().length).toBe(0);
  });

  it("a phone chat viewer's leave does not evict the performer's stream", async () => {
    vi.useFakeTimers();
    // This client is the performer's main stage tab.
    store.SET_MODEL(playerModel);
    await store.joinStage();
    const ownId = String(store.session);
    seedJitsiTile(store, "my-stream", ownId);

    // Phone opens /chat (audience join), then closes it (leaving).
    store.UPDATE_SESSIONS_COUNTER({ id: "phone-chat-uuid", at: Date.now() });
    store.UPDATE_SESSIONS_COUNTER({ id: "phone-chat-uuid", leaving: true, at: Date.now() });
    vi.advanceTimersByTime(300_000);
    store.UPDATE_SESSIONS_COUNTER({ id: "another-event", at: Date.now() });

    expect(hasObject(store, "my-stream")).toBe(true);
    expect(destroyCalls().length).toBe(0);
  });
});
