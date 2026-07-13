<script setup lang="ts">
/**
 * Live RTMP feed tile (board objects with `isRTMP` — stream assets whose
 * file_location is a bare MediaMTX stream key, see /root/streaming2).
 *
 * Playback strategy: WHEP (WebRTC, sub-second) first; if the WebRTC leg
 * fails (media firewalled, no track within the timeout, or a session that
 * decodes no frames — OBS-default B-frames, see the stall watchdog) fall
 * back to LL-HLS via hls.js (native HLS on Safari). While the feed is
 * offline (MediaMTX answers 404) show a placeholder and retry on an
 * interval.
 *
 * The element shares Object.vue's <video> PiP/controls hardening, but NOT
 * its Play/Stop contract: like a jitsi tile, a live feed plays the moment
 * it connects — the lightbulb alone decides who sees/hears it (unpublished
 * objects never reach the audience, see reusable.ts serializeForBroadcast).
 */
import Hls from "hls.js";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStageStore } from "@stores/pinia/stage";
import {
  connectWhep,
  hlsStreamHasAudio,
  hlsUrlForKey,
  opusMirrorKey,
  StreamOfflineError,
  videoFramesDecoded,
  type WhepConnection,
} from "./whepClient";

const props = defineProps<{
  object: {
    id?: string;
    fileLocation?: string;
  };
}>();

const { t } = useI18n();
const stageStore = useStageStore();

const OFFLINE_RETRY_MS = 5000;
const WHEP_TRACK_TIMEOUT_MS = 4000;
// A WHEP session with no audio may mean MediaMTX dropped an AAC track
// (WebRTC can't carry AAC and MediaMTX doesn't transcode — the default
// for OBS/RTMP encoders). The HLS manifest tells us whether the source
// really has audio; it can lag a couple of seconds behind stream start,
// hence the re-check loop instead of a single probe.
const AUDIO_PROBE_ATTEMPTS = 4;
const AUDIO_PROBE_INTERVAL_MS = 2500;
// A WHEP session can negotiate fine and still deliver no video — OBS's
// default encoder settings (High profile with B-frames, which WebRTC
// can't reorder) are the common cause. Track objects arrive, so only the
// decoded-frame counter reveals it; the session then either stalls while
// "connected" or is killed by MediaMTX within seconds. Either way a
// session that ends having decoded under ~a second of video marks the
// feed as unable to ride WebRTC, and playback moves to HLS (which handles
// those feeds fine, at some latency cost) instead of looping on WHEP.
const WHEP_STALL_CHECK_MS = 2000;
const WHEP_STALL_LIMIT_MS = 8000;
const WHEP_BROKEN_FRAME_THRESHOLD = 30;

const video = ref<HTMLVideoElement>();
const state = ref<"connecting" | "live" | "waiting">("connecting");

let whep: WhepConnection | null = null;
let hls: Hls | null = null;
let retryTimer: number | null = null;
let stallTimer: number | null = null;
let whepSessionFrames = 0;
let whepBroken = false;
let disposed = false;

const streamKey = () => props.object.fileLocation ?? "";

function clearRetry() {
  if (retryTimer != null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry() {
  if (disposed) return;
  state.value = "waiting";
  clearRetry();
  retryTimer = window.setTimeout(connect, OFFLINE_RETRY_MS);
}

function stopStallWatchdog() {
  if (stallTimer != null) {
    window.clearInterval(stallTimer);
    stallTimer = null;
  }
}

function startStallWatchdog(connection: WhepConnection) {
  stopStallWatchdog();
  whepSessionFrames = 0;
  let stalledMs = 0;
  stallTimer = window.setInterval(async () => {
    if (disposed || whep !== connection) {
      stopStallWatchdog();
      return;
    }
    const el = video.value;
    if (!el || el.paused) {
      // Not playing (autoplay may still be gesture-blocked) — no frames
      // expected.
      stalledMs = 0;
      return;
    }
    const frames = await videoFramesDecoded(connection.pc);
    if (disposed || whep !== connection) return;
    if (frames > whepSessionFrames) {
      whepSessionFrames = frames;
      stalledMs = 0;
      return;
    }
    stalledMs += WHEP_STALL_CHECK_MS;
    if (stalledMs < WHEP_STALL_LIMIT_MS) return;
    stopStallWatchdog();
    console.info(
      "[stage] live stream WebRTC session decodes no video (encoder settings — e.g. OBS B-frames?); falling back to HLS",
    );
    whepBroken = true;
    await teardown();
    if (!disposed) await connect();
  }, WHEP_STALL_CHECK_MS);
}

async function teardown() {
  clearRetry();
  stopStallWatchdog();
  if (whep) {
    const connection = whep;
    whep = null;
    await connection.close();
  }
  if (hls) {
    hls.destroy();
    hls = null;
  }
  if (video.value) {
    video.value.srcObject = null;
    video.value.removeAttribute("src");
  }
}

// Live feeds play unconditionally once connected (jitsi-tile semantics —
// there is no Play tool for them; the lightbulb governs who sees the
// object at all). Browsers may still block the un-gestured play() with
// audio, so on rejection retry on the next user interaction anywhere on
// the page.
let gestureRetryArmed = false;
const retryPlayOnGesture = () => {
  gestureRetryArmed = false;
  if (!disposed) ensurePlaying();
};

function ensurePlaying() {
  const el = video.value;
  if (!el || state.value !== "live") return;
  const playPromise = el.play();
  if (playPromise) {
    playPromise.catch((error) => {
      console.warn(
        "[stage] live stream play() was blocked; will retry on the next click/tap (or use the Refresh streams button):",
        error?.name || error,
      );
      if (disposed || gestureRetryArmed) return;
      gestureRetryArmed = true;
      document.addEventListener("pointerdown", retryPlayOnGesture, {
        once: true,
        capture: true,
      });
    });
  }
}

function waitForTrack(connection: WhepConnection): Promise<void> {
  if (connection.stream.getTracks().length > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("No WebRTC track within timeout")),
      WHEP_TRACK_TIMEOUT_MS,
    );
    connection.pc.addEventListener("track", () => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

async function tryWhep(key: string): Promise<void> {
  let connection: WhepConnection;
  try {
    // The Opus mirror is the WebRTC-audible twin of the feed (the raw
    // feed's AAC audio can't ride WebRTC).
    connection = await connectWhep(opusMirrorKey(key));
  } catch (mirrorError) {
    if (!(mirrorError instanceof StreamOfflineError)) throw mirrorError;
    // Mirror not up (transcoder still warming up, or a server without
    // it) — read the raw feed; the audio checks below reroute audible
    // AAC feeds to HLS so they aren't left silent.
    connection = await connectWhep(key);
  }
  whep = connection;
  await waitForTrack(connection);
  if (disposed || !video.value) {
    await connection.close();
    whep = null;
    return;
  }
  if (!connection.hasAudio && (await hlsStreamHasAudio(key))) {
    // The source has audio but WHEP dropped it (AAC over WebRTC).
    // Throwing sends connect() down its existing HLS fallback path,
    // which carries the AAC audio at the cost of a little latency.
    console.info(
      "[stage] live stream audio can't ride WebRTC (AAC source); playing via HLS instead",
    );
    throw new Error("WHEP session has no audio for an audible source");
  }
  video.value.srcObject = connection.stream;
  state.value = "live";
  ensurePlaying();
  startStallWatchdog(connection);
  if (!connection.hasAudio) {
    // Manifest may not exist yet right after the publisher starts;
    // keep checking briefly so an audible feed still ends up on HLS.
    probeForLateAudio(key, connection);
  }
  connection.pc.addEventListener("connectionstatechange", () => {
    if (
      whep === connection &&
      (connection.pc.connectionState === "failed" ||
        connection.pc.connectionState === "disconnected")
    ) {
      // Publisher went away, network dropped — or MediaMTX killed a
      // session it couldn't payload (OBS-default B-frames die like this
      // within seconds of connecting). A session that never decoded real
      // video is the latter kind: reconnect on HLS instead of re-polling
      // WHEP into the same wall.
      videoFramesDecoded(connection.pc).then((frames) => {
        if (whep !== connection) return;
        if (Math.max(frames, whepSessionFrames) < WHEP_BROKEN_FRAME_THRESHOLD) {
          whepBroken = true;
          console.info(
            "[stage] live stream WebRTC session died before decoding video (encoder settings — e.g. OBS B-frames?); switching to HLS",
          );
        }
        teardown().then(() => {
          if (disposed) return;
          if (whepBroken) connect();
          else scheduleRetry();
        });
      });
    }
  });
}

async function probeForLateAudio(key: string, connection: WhepConnection): Promise<void> {
  for (let attempt = 0; attempt < AUDIO_PROBE_ATTEMPTS; attempt++) {
    await new Promise((resolve) => window.setTimeout(resolve, AUDIO_PROBE_INTERVAL_MS));
    if (disposed || whep !== connection) return;
    if (await hlsStreamHasAudio(key)) {
      if (disposed || whep !== connection) return;
      // Reconnect from scratch rather than jumping straight to HLS: the
      // fresh attempt prefers the Opus mirror (WebRTC latency, with
      // sound) and only lands on HLS if the mirror still isn't up.
      console.info("[stage] live stream audio became available; reconnecting for sound");
      await teardown();
      await connect();
      return;
    }
  }
}

function tryHls(key: string): Promise<void> {
  const el = video.value;
  if (!el) return Promise.reject(new Error("no video element"));
  const url = hlsUrlForKey(key);
  return new Promise((resolve, reject) => {
    if (Hls.isSupported()) {
      const instance = new Hls({ lowLatencyMode: true });
      hls = instance;
      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        state.value = "live";
        ensurePlaying();
        resolve();
      });
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          reject(new StreamOfflineError(key));
        }
      });
      instance.loadSource(url);
      instance.attachMedia(el);
    } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari: native HLS.
      el.src = url;
      el.addEventListener(
        "loadedmetadata",
        () => {
          state.value = "live";
          ensurePlaying();
          resolve();
        },
        { once: true },
      );
      el.addEventListener("error", () => reject(new StreamOfflineError(key)), { once: true });
    } else {
      reject(new Error("HLS is not supported in this browser"));
    }
  });
}

async function connect() {
  if (disposed) return;
  const key = streamKey();
  if (!key) {
    state.value = "waiting";
    return;
  }
  state.value = "connecting";
  if (whepBroken) {
    // This feed already proved it can't ride WebRTC — go straight to HLS.
    // If HLS fails too the feed has probably ended; forget the verdict so
    // the next publish gets a fresh WHEP (low-latency) chance.
    try {
      await tryHls(key);
    } catch {
      await teardown();
      whepBroken = false;
      scheduleRetry();
    }
    return;
  }
  try {
    await tryWhep(key);
  } catch (whepError) {
    await teardown();
    if (disposed) return;
    if (whepError instanceof StreamOfflineError) {
      scheduleRetry();
      return;
    }
    try {
      await tryHls(key);
    } catch {
      await teardown();
      scheduleRetry();
    }
  }
}

// The Refresh-streams button (ReloadStream.vue → triggerForceReloadStreams)
// is a local per-browser signal: jitsi tiles re-attach their tracks, and a
// live feed reconnects from scratch. Forget any "can't ride WebRTC" verdict
// so the fresh attempt gets the low-latency WHEP path again (the publisher
// may have fixed their encoder settings since).
watch(
  () => stageStore.forceReloadStreams,
  async () => {
    if (disposed) return;
    whepBroken = false;
    await teardown();
    if (!disposed) await connect();
  },
);

onMounted(connect);
onBeforeUnmount(() => {
  disposed = true;
  document.removeEventListener("pointerdown", retryPlayOnGesture, { capture: true });
  teardown();
});
</script>

<template>
  <div class="live-stream-tile">
    <!-- Same hardening attribute set as Object.vue's stream-playback <video>. -->
    <video
      :id="'video' + object.id"
      ref="video"
      class="the-object-video"
      playsinline
      disablePictureInPicture
      controlslist="nodownload nofullscreen noremoteplayback"
    ></video>
    <div v-if="state !== 'live'" class="live-stream-placeholder">
      <i class="fas fa-video" aria-hidden="true"></i>
      <span>{{ t("waiting_for_stream") }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.live-stream-tile {
  position: relative;
  width: 100%;
  height: 100%;
}

.the-object-video {
  width: 100%;
  height: 100%;
  // Same philosophy as a jitsi window (Jitsi.vue): the video is never
  // distorted — it covers the tile and crops what doesn't fit. Resizing
  // keeps the tile's proportions (Moveable keepRatio); performers who want
  // a different picture shape adjust the canvas in OBS.
  object-fit: cover;
  display: block;
  background: #000;
}

.live-stream-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #ddd;
  background: rgba(0, 0, 0, 0.65);
  font-size: 12px;
  text-align: center;
  pointer-events: none;
}
</style>
