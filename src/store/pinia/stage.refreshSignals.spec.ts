// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Refresh-button store signals. All three are LOCAL ticks: nothing is
 * published over MQTT, and each tick is observable as a change so watchers
 * fire on every click (not only the first).
 */

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn(() => Promise.resolve()) }));
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
vi.mock("@services/speech", () => ({ avatarSpeak: vi.fn(), stopSpeaking: vi.fn() }));

import { useStageStore } from "./stage";

beforeEach(() => {
  setActivePinia(createPinia());
  sendMessage.mockClear();
  vi.useFakeTimers();
});

describe("refresh signals", () => {
  it("start unset", () => {
    const s = useStageStore();
    expect(s.reloadStreams).toBeNull();
    expect(s.forceReloadStreams).toBeNull();
    expect(s.meetingRefreshKey).toBe(0);
  });

  it("triggerReloadStreams (page wake) fires only the gentle tick", () => {
    const s = useStageStore();
    s.triggerReloadStreams();
    expect(s.reloadStreams).toBeInstanceOf(Date);
    expect(s.forceReloadStreams).toBeNull();
    expect(s.meetingRefreshKey).toBe(0);
  });

  it("triggerForceReloadStreams (button) fires gentle + force, not the meeting key", () => {
    const s = useStageStore();
    s.triggerForceReloadStreams();
    expect(s.reloadStreams).toBeInstanceOf(Date);
    expect(s.forceReloadStreams).toBeInstanceOf(Date);
    expect(s.meetingRefreshKey).toBe(0);
  });

  it("refreshMeeting bumps only the meeting key, once per call", () => {
    const s = useStageStore();
    s.refreshMeeting();
    s.refreshMeeting();
    expect(s.meetingRefreshKey).toBe(2);
    expect(s.reloadStreams).toBeNull();
    expect(s.forceReloadStreams).toBeNull();
  });

  it("every force tick is a distinct value so a second click re-triggers watchers", () => {
    const s = useStageStore();
    s.triggerForceReloadStreams();
    const first = s.forceReloadStreams;
    vi.advanceTimersByTime(1);
    s.triggerForceReloadStreams();
    expect(s.forceReloadStreams).not.toBe(first);
  });

  it("none of the refresh signals publish over MQTT", () => {
    const s = useStageStore();
    s.triggerReloadStreams();
    s.triggerForceReloadStreams();
    s.refreshMeeting();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
