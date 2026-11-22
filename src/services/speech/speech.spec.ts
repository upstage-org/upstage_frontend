// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The speech service must not depend on meSpeak having loaded before the
 * module is imported: when that script download failed, the import threw
 * and the whole stage page failed to start (prod, 2026-11-23).
 */
describe("speech service without / with the meSpeak library", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as unknown as { meSpeak?: unknown }).meSpeak;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const avatar = { voice: { voice: "en/en", variant: "f1", pitch: 50, speed: 175 } };

  it("imports and stays silent when meSpeak is missing", async () => {
    const speech = await import("./index");
    expect(() => speech.avatarSpeak(avatar, "hello")).not.toThrow();
    expect(() => speech.stopSpeaking()).not.toThrow();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("uses meSpeak once it is there, even if it arrived after the import", async () => {
    const speech = await import("./index");
    const speak = vi.fn();
    const loadVoice = vi.fn((_voice: string, cb: () => void) => cb());
    const stop = vi.fn();
    (window as unknown as { meSpeak: unknown }).meSpeak = { loadVoice, speak, stop };
    speech.avatarSpeak(avatar, "hello");
    expect(loadVoice).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith("hello", expect.objectContaining({ variant: "f1" }));
    speech.stopSpeaking();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
