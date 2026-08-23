// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Selection-frame (activeMovable) regression tests.
 *
 * `joinStage()` re-runs on the 5-minute presence heartbeat, on every MQTT
 * (re)connect, and on nickname save. It used to end with an unconditional
 * `SET_ACTIVE_MOVABLE(avatarId)`, which re-pointed the player's selection
 * frame at their held avatar — or dismissed it entirely when they held no
 * avatar — every time any of those fired. Symptom: the green frame (and its
 * quick-action buttons, e.g. the text pen) kept vanishing / flipping away
 * while a player was working on another object.
 *
 * The claim-time selection ("double-click to hold an avatar shows its
 * frame") now lives in user.ts `setAvatarId` instead.
 */

const { sendMessage } = vi.hoisted(() => ({
  sendMessage: vi.fn((..._args: unknown[]) => Promise.resolve()),
}));
vi.mock("@services/mqtt", () => ({
  default: () => ({
    connect: vi.fn(),
    whenConnected: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => Promise.resolve()),
    sendMessage,
    sendMessageSync: vi.fn(),
    receiveMessage: vi.fn(),
  }),
}));
// stage.ts transitively imports the meSpeak-backed speech service, which
// reads `window.meSpeak` at module scope (absent under jsdom).
vi.mock("@services/speech", () => ({
  avatarSpeak: vi.fn(),
  stopSpeaking: vi.fn(),
}));

import { useStageStore } from "./stage";
import { useUserStore } from "./user";

type StageStore = ReturnType<typeof useStageStore>;
type StageModelArg = Parameters<StageStore["SET_MODEL"]>[0];
type BoardObjectArg = Parameters<StageStore["PUSH_OBJECT"]>[0];

// reconcileAvatarHolds (run by UPDATE_SESSIONS_COUNTER inside joinStage)
// nulls any hold whose avatar id is not a live board object, so every test
// that claims an avatar must actually place it on the board first.
const seedAvatar = (store: StageStore, id: string) =>
  store.PUSH_OBJECT({
    id,
    name: id,
    type: "avatar",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
  } as unknown as BoardObjectArg);

const playerModel = { permission: "owner", assets: [] } as unknown as StageModelArg;
const audienceModel = { permission: "audience", assets: [] } as unknown as StageModelArg;

let store: StageStore;
let userStore: ReturnType<typeof useUserStore>;
beforeEach(() => {
  setActivePinia(createPinia());
  store = useStageStore();
  userStore = useUserStore();
  sendMessage.mockClear();
});

describe("joinStage vs the selection frame", () => {
  it("keeps the player's selection when no avatar is held (heartbeat/reconnect path)", async () => {
    store.SET_MODEL(playerModel);
    store.SET_ACTIVE_MOVABLE("text-1");
    await store.joinStage();
    expect(store._activeMovable).toBe("text-1");
  });

  it("does not re-point the selection at the held avatar", async () => {
    store.SET_MODEL(playerModel);
    seedAvatar(store, "avatar-1");
    userStore.$patch({ avatarId: "avatar-1" });
    store.SET_ACTIVE_MOVABLE("text-1");
    await store.joinStage();
    expect(store._activeMovable).toBe("text-1");
  });

  it("still publishes the presence payload with the held avatar", async () => {
    store.SET_MODEL(playerModel);
    seedAvatar(store, "avatar-1");
    userStore.$patch({ avatarId: "avatar-1" });
    await store.joinStage();
    const counterCall = sendMessage.mock.calls.find(
      (call) => (call[1] as { avatarId?: unknown } | undefined)?.avatarId === "avatar-1",
    );
    expect(counterCall).toBeTruthy();
  });

  it("clears both hold and selection when the seat is not a player (demotion)", async () => {
    store.SET_MODEL(audienceModel);
    seedAvatar(store, "avatar-1");
    userStore.$patch({ avatarId: "avatar-1" });
    store.SET_ACTIVE_MOVABLE("avatar-1");
    await store.joinStage();
    expect(userStore.avatarId).toBeNull();
    expect(store._activeMovable).toBeNull();
  });
});

describe("setAvatarId (claim-time selection)", () => {
  it("selects the freshly claimed avatar", () => {
    store.SET_MODEL(playerModel);
    seedAvatar(store, "avatar-2");
    userStore.setAvatarId("avatar-2");
    expect(userStore.avatarId).toBe("avatar-2");
    expect(store._activeMovable).toBe("avatar-2");
  });

  it("release (null) clears hold and selection", () => {
    store.SET_MODEL(playerModel);
    seedAvatar(store, "avatar-2");
    userStore.setAvatarId("avatar-2");
    userStore.setAvatarId(null);
    expect(userStore.avatarId).toBeNull();
    expect(store._activeMovable).toBeNull();
  });
});
