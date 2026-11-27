import { describe, expect, it } from "vitest";
import {
  ACTIVITY_PRESENCE_MS,
  PRESENCE_TTL_MS,
  UNLOAD_GRACE_MS,
  eventsForEntry,
  isSessionScopedEvent,
  sessionScopeStart,
} from "./stageSession";
import type { ReplayEvent } from "./stage.types";

/**
 * #1572: the on-stage background colour is temporary. It lasts while the
 * stage stays occupied (presence is read from the archived `counter`
 * events) and is not replayed for whoever enters after the stage has been
 * empty. All times below are in seconds, as the archive stores them.
 */

const T0 = 1_700_000_000;
let nextId = 1;
const counter = (at: number, id: string, extra: Record<string, unknown> = {}): ReplayEvent =>
  ({
    id: nextId++,
    topic: "unit/stage/counter",
    mqttTimestamp: at,
    payload: { id, at: at * 1000, isPlayer: true, ...extra },
  }) as ReplayEvent;
const colour = (at: number, color = "#123456"): ReplayEvent =>
  ({
    id: nextId++,
    topic: "unit/stage/background",
    mqttTimestamp: at,
    payload: { type: "setBackdropColor", color },
  }) as ReplayEvent;
const move = (at: number): ReplayEvent =>
  ({
    id: nextId++,
    topic: "unit/stage/board",
    mqttTimestamp: at,
    payload: { type: "moveTo", object: { id: 1 } },
  }) as ReplayEvent;
const ms = (seconds: number) => seconds * 1000;

describe("sessionScopeStart", () => {
  it("is now when nobody has ever been on the stage", () => {
    expect(sessionScopeStart([], ms(T0))).toBe(ms(T0));
    // Activity without any presence row is still evidence of a publisher,
    // but only for one heartbeat period.
    const stale = T0 - ACTIVITY_PRESENCE_MS / 1000 - 1;
    expect(sessionScopeStart([move(stale), colour(stale)], ms(T0))).toBe(ms(T0));
  });

  it("recent activity keeps the run alive when the presence rows were swept away", () => {
    // Sweep moved every row at T0+100 into the performance (nothing left),
    // the performer who is still connected sets a colour at T0+110 and the
    // audience enters at T0+120: the colour must apply.
    const events = [colour(T0 + 110)];
    expect(sessionScopeStart(events, ms(T0 + 120))).toBe(ms(T0 + 110));
    // …and the heartbeat that follows joins up with it.
    const later = [colour(T0 + 110), counter(T0 + 300, "a")];
    expect(sessionScopeStart(later, ms(T0 + 400))).toBe(ms(T0 + 110));
  });

  it("a leave ends the presence that activity implied", () => {
    const events = [colour(T0), counter(T0 + 5, "a", { leaving: true })];
    expect(sessionScopeStart(events, ms(T0 + 10))).toBe(ms(T0 + 10));
  });

  it("uses the run's start even when the client's clock is behind the server", () => {
    const events = [counter(T0, "a"), counter(T0 + 300, "a")];
    expect(sessionScopeStart(events, ms(T0 - 120))).toBe(ms(T0));
  });

  it("starts at the first join of a run that is still alive", () => {
    const events = [counter(T0, "a"), counter(T0 + 300, "a"), counter(T0 + 600, "a")];
    expect(sessionScopeStart(events, ms(T0 + 900))).toBe(ms(T0));
  });

  it("ends the run when the only tab leaves through the app", () => {
    const events = [counter(T0, "a"), counter(T0 + 60, "a", { leaving: true })];
    expect(sessionScopeStart(events, ms(T0 + 70))).toBe(ms(T0 + 70));
  });

  it("keeps the run alive through a reload (unload leave, rejoin inside the grace)", () => {
    const events = [
      counter(T0, "a"),
      counter(T0 + 60, "a", { leaving: true, unload: true }),
      counter(T0 + 65, "a"),
    ];
    expect(sessionScopeStart(events, ms(T0 + 100))).toBe(ms(T0));
  });

  it("ends the run when a closed tab does not come back within the grace", () => {
    const left = T0 + 60;
    const events = [counter(T0, "a"), counter(left, "a", { leaving: true, unload: true })];
    const after = ms(left) + UNLOAD_GRACE_MS + 1;
    expect(sessionScopeStart(events, after)).toBe(after);
    const rejoin = counter(left + UNLOAD_GRACE_MS / 1000 + 10, "a");
    expect(sessionScopeStart([...events, rejoin], ms(T0 + 200))).toBe(
      ms(left + UNLOAD_GRACE_MS / 1000 + 10),
    );
  });

  it("another tab keeps the stage occupied while one performer reloads", () => {
    const events = [
      counter(T0, "performer"),
      counter(T0 + 10, "audience"),
      counter(T0 + 60, "performer", { leaving: true }),
      counter(T0 + 120, "performer"),
    ];
    expect(sessionScopeStart(events, ms(T0 + 130))).toBe(ms(T0));
  });

  it("a tab that vanished without leaving counts for the presence TTL only", () => {
    const events = [counter(T0, "a")];
    expect(sessionScopeStart(events, ms(T0) + PRESENCE_TTL_MS)).toBe(ms(T0));
    expect(sessionScopeStart(events, ms(T0) + PRESENCE_TTL_MS + 1)).toBe(
      ms(T0) + PRESENCE_TTL_MS + 1,
    );
  });

  it("a join after a quiet hour starts a new run", () => {
    const later = T0 + PRESENCE_TTL_MS / 1000 + 100;
    const events = [counter(T0, "a"), counter(later, "b")];
    expect(sessionScopeStart(events, ms(later + 5))).toBe(ms(later));
  });

  it("ignores a leave for a tab it never saw and malformed rows", () => {
    const events = [
      counter(T0, "ghost", { leaving: true }),
      { id: 9, topic: "unit/stage/counter", mqttTimestamp: NaN, payload: { id: "x" } },
      { id: 10, topic: "unit/stage/counter", mqttTimestamp: T0, payload: null },
      counter(T0 + 1, "a"),
    ] as ReplayEvent[];
    expect(sessionScopeStart(events, ms(T0 + 2))).toBe(ms(T0 + 1));
  });

  it("accepts millisecond timestamps too", () => {
    const events = [counter(ms(T0), "a")];
    expect(sessionScopeStart(events, ms(T0 + 5))).toBe(ms(T0));
  });
});

describe("eventsForEntry", () => {
  it("only treats the background colour as session-scoped", () => {
    expect(isSessionScopedEvent(colour(T0))).toBe(true);
    expect(isSessionScopedEvent(move(T0))).toBe(false);
    expect(
      isSessionScopedEvent({
        id: 1,
        topic: "unit/stage/background",
        mqttTimestamp: T0,
        payload: { type: "drawCurtain" },
      } as ReplayEvent),
    ).toBe(false);
  });

  it("drops a colour set before the stage was last empty and keeps everything else", () => {
    const events = [
      counter(T0, "a"),
      colour(T0 + 10, "#111111"),
      move(T0 + 20),
      counter(T0 + 30, "a", { leaving: true }),
      counter(T0 + 100, "b"),
      move(T0 + 110),
    ];
    const kept = eventsForEntry(events, ms(T0 + 120));
    expect(kept.map((e) => e.id)).toEqual(events.filter((e) => e !== events[1]).map((e) => e.id));
  });

  it("keeps a colour set during the run that is still going on", () => {
    const events = [counter(T0, "a"), colour(T0 + 10, "#111111"), move(T0 + 20)];
    expect(eventsForEntry(events, ms(T0 + 30))).toEqual(events);
  });

  it("drops every colour when the stage is empty now", () => {
    const events = [counter(T0, "a"), colour(T0 + 10), counter(T0 + 20, "a", { leaving: true })];
    expect(eventsForEntry(events, ms(T0 + 40)).map((e) => e.id)).toEqual([
      events[0].id,
      events[2].id,
    ]);
  });
});
