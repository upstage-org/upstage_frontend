// @ts-nocheck
import { onUnmounted, watch } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { isJitsiBoardType, resolveJitsiOrigin } from "@utils/common";
import configs from "config";
import { useLowLevelAPI } from "./composable";

/**
 * Multi-server streaming: publish this performer's camera into every Jitsi
 * server (other than the default) that has one of their tiles on the board.
 *
 * Model: a stream tile is bound to ONE server (`jitsiServer`, stamped by the
 * per-server Yourself tile in the Streams tab), like an RTMP feed is bound
 * to one MediaMTX. A performer may have tiles on several servers at once, so
 * the same camera has to be sent into several conferences at once. The
 * default server keeps the untouched `localStreamPublisher` (which owns the
 * camera capture); each other server gets CLONES of those tracks:
 *
 *   MediaStreamTrack.clone()  →  JitsiMeetJS.createLocalTracksFromMediaStreams
 *
 * A clone is an independent track fed by the same capture, so it can be
 * added to a second `JitsiConference` (a JitsiLocalTrack belongs to exactly
 * one conference) without a second getUserMedia — which iOS Safari would
 * refuse (one live capture per device) and which would churn the primary
 * publisher's storm guards. Disposing a clone stops only the clone.
 *
 * Per extra server the rule is simply:
 *   own tiles on that server > 0  ⇒ clones published into its room,
 *   own tiles on that server = 0  ⇒ clones removed from its room + disposed.
 * plus "primary tracks replaced (device change / re-acquire) ⇒ re-clone".
 *
 * No-op unless more than one server is configured, so single-server installs
 * do not execute any of this.
 */
export function useExtraServerPublishers(jitsi, publisher) {
  const multiServer = (configs.JITSI_SERVER_COUNT ?? 1) > 1;
  const api = {
    /** Origins whose room currently carries this tab's cloned tracks. */
    publishedOrigins: () => [] as string[],
    /** Re-evaluate every extra server now (tests / explicit callers). */
    reconcile: async () => {},
  };
  if (!multiServer) return api;

  const JitsiMeetJS = useLowLevelAPI();
  const stageStore = useStageStore();
  const extraOrigins = (configs.JITSI_ENDPOINTS ?? []).filter((o) => o !== configs.JITSI_ENDPOINT);

  type State = { clones: unknown[]; source: unknown[]; published: boolean };
  const states = new Map<string, State>();
  const stateFor = (origin: string): State => {
    let s = states.get(origin);
    if (!s) {
      s = { clones: [], source: [], published: false };
      states.set(origin, s);
    }
    return s;
  };

  const publishingAllowed = (): boolean =>
    Boolean(stageStore.canPlay) && Boolean(stageStore.jitsiStreamingEnabled);

  // Same "own tile" test as the primary publisher, restricted to one server:
  // placed by this tab (hostId) or carrying the id this tab has THERE.
  const countOwnTilesOn = (origin: string): number => {
    const mySession = stageStore.session;
    const myId = stageStore.localJitsiParticipantIds?.[origin];
    return stageStore.board.objects.filter((o) => {
      if (!isJitsiBoardType(o.type)) return false;
      if (resolveJitsiOrigin(o.jitsiServer) !== origin) return false;
      if (myId != null && o.participantId === myId) return true;
      return mySession != null && o.hostId === mySession;
    }).length;
  };

  const primaryTracks = (): unknown[] => jitsi?.localTracks?.value ?? [];
  const healthy = (tracks: unknown[]): boolean =>
    tracks.length > 0 && tracks.every((t) => !(t as { isEnded?: () => boolean }).isEnded?.());
  const sameTracks = (a: unknown[], b: unknown[]): boolean =>
    a.length === b.length && a.every((t, i) => t === b[i]);

  const roomFor = (origin: string) => {
    const session = jitsi?.sessions?.get?.(origin);
    if (!session || !session.joined?.value) return null;
    return session.target?.room ?? null;
  };

  const cloneTracks = (source: unknown[]): unknown[] => {
    const infos = [];
    for (const t of source) {
      const mediaStreamTrack = (t as { getTrack?: () => MediaStreamTrack }).getTrack?.();
      if (!mediaStreamTrack || typeof mediaStreamTrack.clone !== "function") continue;
      const clone = mediaStreamTrack.clone();
      infos.push({
        stream: new MediaStream([clone]),
        mediaType: clone.kind,
        videoType: clone.kind === "video" ? "camera" : undefined,
      });
    }
    if (infos.length === 0) return [];
    return JitsiMeetJS.createLocalTracksFromMediaStreams(infos) ?? [];
  };

  const disposeClones = (state: State) => {
    for (const c of state.clones) {
      try {
        (c as { dispose?: () => void }).dispose?.();
      } catch (e) {
        console.warn("Disposing cloned local track:", e);
      }
    }
    state.clones = [];
    state.source = [];
    state.published = false;
  };

  const unpublish = async (origin: string, state: State) => {
    const room = roomFor(origin);
    for (const c of state.clones) {
      if (room) {
        try {
          await room.removeTrack(c);
        } catch (err) {
          console.warn(`room.removeTrack (${origin}) failed:`, err);
        }
      }
      // TRACK_REMOVED normally does this; make sure a dead room can't leave
      // a stale clone in board.tracks.
      stageStore.removeTrack(c);
    }
    disposeClones(state);
    console.log("[diag] extraServerPublishers: unpublished", { origin });
  };

  const publish = async (origin: string, state: State) => {
    const room = roomFor(origin);
    if (!room) return;
    const source = primaryTracks();
    if (!healthy(source)) return;
    let clones: unknown[];
    try {
      clones = cloneTracks(source);
    } catch (err) {
      console.warn(`Cloning local tracks for ${origin} failed:`, err);
      return;
    }
    if (clones.length === 0) return;
    state.clones = clones;
    state.source = source.slice();
    for (const c of clones) {
      try {
        await room.addTrack(c);
        stageStore.addTrack(c, origin);
      } catch (err) {
        console.warn(`room.addTrack (${origin}) failed:`, err);
      }
    }
    state.published = true;
    const myId = room.myUserId?.();
    if (myId) stageStore.ensureJitsiTileParticipantBroadcast(String(myId), origin);
    console.log("[diag] extraServerPublishers: published", { origin, tracks: clones.length });
  };

  const reconcileOnce = async () => {
    for (const origin of extraOrigins) {
      const state = stateFor(origin);
      const wanted = publishingAllowed() && countOwnTilesOn(origin) > 0;
      const sourceChanged = state.published && !sameTracks(state.source, primaryTracks());
      if (state.published && (!wanted || sourceChanged)) await unpublish(origin, state);
      if (wanted && !state.published) await publish(origin, state);
    }
  };

  // One reconcile at a time; a change that lands mid-run queues one more
  // pass so nothing is missed (the async add/remove loops await the rooms).
  let running = false;
  let pending = false;
  const schedule = async () => {
    pending = true;
    if (running) return;
    running = true;
    try {
      while (pending) {
        pending = false;
        await reconcileOnce();
      }
    } finally {
      running = false;
    }
  };

  // Mirror of the primary publisher's board watcher: ignore board churn
  // while the MQTT session is not LIVE (event replay on load), and never
  // tear a publish down just because the broker is reconnecting.
  const liveSchedule = () => {
    if (stageStore.status !== "LIVE") return;
    void schedule();
  };

  watch(
    () =>
      extraOrigins
        .map((o) => `${o}:${countOwnTilesOn(o)}:${stageStore.localJitsiParticipantIds?.[o] ?? ""}`)
        .join("|") + `#${publishingAllowed() ? 1 : 0}#${stageStore.status}`,
    liveSchedule,
    { immediate: true },
  );
  // Primary tracks replaced (re-acquire) or released: re-clone / drop.
  watch(() => jitsi?.localTracks?.value, liveSchedule);

  // Explicit "Refresh streams": remove+add the same clones (fresh SSRCs for
  // every viewer), exactly what the primary publisher does for its room.
  const forceRepublish = async () => {
    for (const origin of extraOrigins) {
      const state = stateFor(origin);
      if (!state.published) continue;
      const room = roomFor(origin);
      if (!room) continue;
      for (const c of state.clones) {
        try {
          await room.removeTrack(c);
        } catch (err) {
          console.warn(`room.removeTrack (${origin}) failed:`, err);
        }
        try {
          await room.addTrack(c);
          stageStore.addTrack(c, origin);
        } catch (err) {
          console.warn(`room.addTrack (${origin}) failed:`, err);
        }
      }
      const myId = room.myUserId?.();
      if (myId) stageStore.ensureJitsiTileParticipantBroadcast(String(myId), origin);
    }
  };
  watch(
    () => stageStore.forceReloadStreams,
    (tick) => {
      if (tick) void forceRepublish();
    },
  );
  // Gentle reload tick (wake / focus): only recover a clone that has died.
  watch(
    () => stageStore.reloadStreams,
    async (tick) => {
      if (!tick) return;
      for (const origin of extraOrigins) {
        const state = stateFor(origin);
        if (state.published && !healthy(state.clones)) {
          await unpublish(origin, state);
        }
      }
      liveSchedule();
    },
  );

  onUnmounted(() => {
    // Rooms are being left by the composable; just stop the clones.
    for (const state of states.values()) disposeClones(state);
  });

  api.publishedOrigins = () =>
    [...states.entries()].filter(([, s]) => s.published).map(([origin]) => origin);
  api.reconcile = schedule;
  // `publisher` is accepted for symmetry with Shell.vue's wiring; the
  // primary tracks are read through `jitsi.localTracks`, which it maintains.
  void publisher;
  return api;
}
