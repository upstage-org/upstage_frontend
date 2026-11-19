import { BACKGROUND_ACTIONS, TOPICS } from "@utils/constants";
import type { ReplayEvent } from "./stage.types";

/**
 * Session scope for temporary on-stage settings (#1572).
 *
 * The background colour picked with the on-stage Settings tool is a
 * temporary override of the colour saved in Stage Management. Like every
 * other on-stage action it travels as an MQTT event, which the backend
 * archives and every later entrant replays, so without a boundary the
 * override outlived the session it was made in: leave the stage, come back
 * the next day, and the "temporary" colour was still there.
 *
 * The boundary is "the stage has been empty". Presence is in the same
 * archive: every tab announces itself on `counter` when it joins and every
 * five minutes after that (the heartbeat), and publishes `leaving` on the
 * way out. A run of presence is the union of those announcements, each good
 * for PRESENCE_TTL_MS (the roster trim in UPDATE_SESSIONS_COUNTER) or until
 * the same tab's `leaving`. Overrides made during the run that is still
 * going on when a client enters apply; overrides from before the stage was
 * last empty do not. Every client derives this from the same log, so a
 * performer who reloads mid-show and an audience member who arrives later
 * see the same colour, and a stage nobody is on reverts to its saved default
 * for whoever comes next. Sweeping the stage ends everything as before.
 *
 * A leave sent from `pagehide` (`unload: true`) keeps the run alive for
 * UNLOAD_GRACE_MS: a reload publishes that leave and rejoins seconds later,
 * and must not end the session when nobody else happens to be on the stage.
 * Leaving through the app (the logo, Studio links) ends the tab's presence
 * at once.
 */
export const PRESENCE_TTL_MS = 60 * 60 * 1000;
export const UNLOAD_GRACE_MS = 30 * 1000;

interface CounterPayload {
  id?: unknown;
  leaving?: boolean;
  unload?: boolean;
}

interface Interval {
  start: number;
  end: number;
}

/** Last segment of a namespaced topic (`dev/<stage>/counter` → `counter`). */
const topicKind = (topic: unknown): string => {
  if (typeof topic !== "string") return "";
  const i = topic.lastIndexOf("/");
  return i === -1 ? topic : topic.slice(i + 1);
};

/** Archive timestamps are seconds (`time.time()`); tolerate milliseconds. */
export const eventTimeMs = (event: ReplayEvent): number => {
  const t = Number(event.mqttTimestamp);
  if (!Number.isFinite(t)) return NaN;
  return t > 1e12 ? t : t * 1000;
};

/** An event that only lasts for the session it was made in. */
export function isSessionScopedEvent(event: ReplayEvent): boolean {
  if (topicKind(event.topic) !== TOPICS.BACKGROUND) return false;
  const payload = event.payload as { type?: unknown } | null | undefined;
  return payload?.type === BACKGROUND_ACTIONS.SET_BACKDROP_COLOR;
}

/**
 * When the run of presence that is still going on at `now` began, in
 * milliseconds — or `now` itself when the stage is empty at `now`.
 * Session-scoped events at or after this time apply; earlier ones do not.
 */
export function sessionScopeStart(events: ReplayEvent[], now: number): number {
  const open = new Map<string, Interval>();
  const intervals: Interval[] = [];
  for (const event of events) {
    if (topicKind(event.topic) !== TOPICS.COUNTER) continue;
    const t = eventTimeMs(event);
    if (!Number.isFinite(t)) continue;
    const payload = (event.payload ?? {}) as CounterPayload;
    const id = payload.id != null ? String(payload.id) : "";
    if (!id) continue;
    const current = open.get(id);
    if (payload.leaving) {
      if (!current) continue;
      const end = t + (payload.unload ? UNLOAD_GRACE_MS : 0);
      if (end < current.end) current.end = Math.max(current.start, end);
      continue;
    }
    if (current && current.end >= t) {
      current.end = Math.max(current.end, t + PRESENCE_TTL_MS);
    } else {
      const next = { start: t, end: t + PRESENCE_TTL_MS };
      open.set(id, next);
      intervals.push(next);
    }
  }
  intervals.sort((a, b) => a.start - b.start);
  let run: Interval | null = null;
  for (const interval of intervals) {
    if (run && interval.start <= run.end) {
      run.end = Math.max(run.end, interval.end);
    } else {
      run = { ...interval };
    }
  }
  if (!run || run.end < now) return now;
  return Math.min(run.start, now);
}

/**
 * The archived events to replay when entering a stage: everything, minus
 * session-scoped settings from before the current run of presence.
 */
export function eventsForEntry(events: ReplayEvent[], now: number): ReplayEvent[] {
  const since = sessionScopeStart(events, now);
  return events.filter((event) => !isSessionScopedEvent(event) || eventTimeMs(event) >= since);
}
