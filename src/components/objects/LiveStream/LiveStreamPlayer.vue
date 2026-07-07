<script setup lang="ts">
/**
 * Live RTMP feed tile (board objects with `isRTMP` — stream assets whose
 * file_location is a bare MediaMTX stream key, see /root/streaming2).
 *
 * Playback strategy: WHEP (WebRTC, sub-second) first; if the WebRTC leg
 * fails (media firewalled, no track within the timeout) fall back to
 * LL-HLS via hls.js (native HLS on Safari). While the feed is offline
 * (MediaMTX answers 404) show a placeholder and retry on an interval.
 *
 * The element mirrors Object.vue's <video> contract: same PiP/controls
 * hardening, and the performer's Play/Stop context tool drives
 * `object.isPlaying` for everyone (paused live video shows a frozen frame).
 */
import Hls from "hls.js";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { connectWhep, hlsUrlForKey, StreamOfflineError, type WhepConnection } from "./whepClient";

const props = defineProps<{
  object: {
    id?: string;
    fileLocation?: string;
    isPlaying?: boolean;
  };
}>();

const { t } = useI18n();

const OFFLINE_RETRY_MS = 5000;
const WHEP_TRACK_TIMEOUT_MS = 4000;

const video = ref<HTMLVideoElement>();
const state = ref<"connecting" | "live" | "waiting">("connecting");

let whep: WhepConnection | null = null;
let hls: Hls | null = null;
let retryTimer: number | null = null;
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

async function teardown() {
  clearRetry();
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

function applyPlayState() {
  const el = video.value;
  if (!el || state.value !== "live") return;
  if (props.object.isPlaying) {
    const playPromise = el.play();
    if (playPromise) {
      playPromise.catch((error) => {
        // Same contract as Object.vue: browsers block un-gestured playback
        // with audio; the performer/audience can use the Play tool.
        console.warn(
          "[stage] live stream play() was blocked; right-click the object and choose Play to start it:",
          error?.name || error,
        );
      });
    }
  } else {
    el.pause();
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
  const connection = await connectWhep(key);
  whep = connection;
  await waitForTrack(connection);
  if (disposed || !video.value) {
    await connection.close();
    whep = null;
    return;
  }
  video.value.srcObject = connection.stream;
  state.value = "live";
  applyPlayState();
  connection.pc.addEventListener("connectionstatechange", () => {
    if (
      whep === connection &&
      (connection.pc.connectionState === "failed" ||
        connection.pc.connectionState === "disconnected")
    ) {
      // Publisher went away or network dropped: tear down and re-poll.
      teardown().then(scheduleRetry);
    }
  });
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
        applyPlayState();
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
          applyPlayState();
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

watch(
  () => props.object.isPlaying,
  () => applyPlayState(),
);

onMounted(connect);
onBeforeUnmount(() => {
  disposed = true;
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
