// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { sharedClockState, useSharedClock } from "./useSharedClock";

const Clock = defineComponent({
  setup() {
    const now = useSharedClock();
    return () => h("span", String(now.value));
  },
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useSharedClock", () => {
  it("runs one interval for any number of subscribers and stops with the last one", async () => {
    expect(sharedClockState()).toEqual({ subscribers: 0, running: false });
    const a = mount(Clock);
    const b = mount(Clock);
    expect(sharedClockState()).toEqual({ subscribers: 2, running: true });
    expect(vi.getTimerCount()).toBe(1);

    const before = Number(a.text());
    vi.setSystemTime(Date.now() + 1500);
    vi.advanceTimersByTime(1000);
    await a.vm.$nextTick();
    expect(Number(a.text())).toBeGreaterThan(before);
    expect(b.text()).toBe(a.text());

    a.unmount();
    expect(sharedClockState()).toEqual({ subscribers: 1, running: true });
    b.unmount();
    expect(sharedClockState()).toEqual({ subscribers: 0, running: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});
