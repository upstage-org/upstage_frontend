<script>
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { message } from "ant-design-vue";
import { useStageStore } from "@stores/pinia/stage";
import { animate } from "animejs";
import { createGaplessLooper } from "./gaplessLoop";

// See the undecodable-file detection in `setRef` below. Exported for tests.
export const INSTANT_END_MS = 500;
export const INSTANT_END_MIN_REMAINING_S = 1;

export default {
  setup: () => {
    const stageStore = useStageStore();
    // The automatic stop when THIS client's copy of a track finishes (or
    // turns out to be unplayable).
    // - Only a performing session publishes it. This component is mounted
    //   for everyone, and an audience session must never affect the
    //   performance: its playback can lag the performer's by seconds, and
    //   its "stop" used to silence a track the performer had just started
    //   again. A non-performing session just settles its own copy.
    // - `endedPlayId` names the run that finished, so that even between
    //   performers a late stop for an old run cannot end a new one (see
    //   UPDATE_AUDIO in the stage store).
    const stopAudio = (audio) => {
      const stopped = {
        ...audio,
        isPlaying: false,
        currentTime: 0,
        endedPlayId: audio.playId ?? null,
      };
      if (stageStore.canPlay) stageStore.updateAudioStatus(stopped);
      else stageStore.UPDATE_AUDIO(stopped);
    };
    const audios = stageStore.audios;
    // Track → <audio> element. Keyed by the track object itself (the v-for
    // is `:key="audio"`, so an element is bound to one track for its whole
    // life). This replaced an index-based `refs` array that grew on every
    // re-render: Vue re-invokes a function ref on each patch, so each
    // element was pushed again and its listeners registered again.
    // Measured on the deployed dev bundle 2026-09-10: every element had
    // `ended`/`timeupdate` bound twice (double stop messages, double
    // loop-restart), and a track added after the first render (a media
    // assignment while the stage is open) got a status index past the end
    // of the list — its play command reached the FIRST element instead,
    // and its timer updates landed on a phantom row.
    const elementFor = new Map();
    const wired = new WeakSet();
    // element → { at, from }: when/where its current run of playback began.
    // Read by the undecodable-file check in `ended`; `from` is moved by our
    // own seeks (handleAudioChange) — see the note there.
    const playWindows = new WeakMap();
    // Gapless looping (see gaplessLoop.ts). The element stays the transport
    // and clock; for a looping track a Web Audio voice takes over the SOUND
    // and the element runs on muted. Best effort: whenever the voice cannot
    // run, the element loop below is used exactly as before.
    const looper = createGaplessLooper({
      onLost: (el) => {
        el.muted = false;
      },
    });
    const prepareLoop = (audio, el) => {
      if (audio.loop && audio.src && isFinite(el.duration)) looper.prepare(audio.src, el.duration);
    };
    const releaseLoop = (el, { resync = false } = {}) => {
      if (!looper.isActive(el)) return;
      // Handing the sound back mid-play (loop switched off): continue from
      // where the voice is, not from the element's slightly different clock.
      const position = resync ? looper.position(el) : null;
      looper.stop(el);
      if (position != null) el.currentTime = position;
      el.muted = false;
    };
    const takeOverLoop = (audio, el, offset) => {
      if (!looper.isReady(audio.src)) return false;
      const started = looper.start(el, audio.src, {
        offset,
        volume: el.volume,
        rate: el.playbackRate,
      });
      if (started) el.muted = true;
      // A restart (seek) that cannot sound must not leave the old voice
      // playing from the old position behind a muted element.
      else releaseLoop(el);
      return started;
    };
    // Index the toolbox reads `audioPlayers[i]` with — resolved at event
    // time so it always matches the track's current position.
    const indexOf = (audio) => audios.indexOf(audio);
    const setRef = (el, audio) => {
      if (!el) {
        const gone = elementFor.get(audio);
        if (gone !== undefined) {
          looper.stop(gone);
          elementFor.delete(audio);
        }
        return;
      }
      elementFor.set(audio, el);
      // A track added with `changed` already set (assignment or scene load
      // while on stage) is skipped by the watcher pass that runs before its
      // element exists; apply it now that the element is here.
      if (audio.changed) queueMicrotask(() => handleAudioChange());
      if (!wired.has(el)) {
        wired.add(el);
        // Undecodable-file detection. A mislabelled upload (e.g. an MP4
        // container saved as `.mp3`) loads fine in Chromium/Brave —
        // metadata, duration, no `error` event — but `play()` jumps
        // straight to the end and fires `ended` within milliseconds. The
        // handler below then reset it to 0 (and, with loop on, restarted
        // it, spinning play → ended → seek forever), so the performer saw
        // "goes immediately to zero, never plays" with no explanation.
        // Remember where/when the last play started; an `ended` that
        // arrives within INSTANT_END_MS of a start that still had more than
        // INSTANT_END_MIN_REMAINING_S to play is reported and stopped
        // instead. Seeking near the end and genuinely short clips fall
        // outside both bounds, so normal playback is untouched.
        playWindows.set(el, { at: 0, from: 0 });
        el.addEventListener("play", function () {
          playWindows.set(el, { at: performance.now(), from: el.currentTime });
        });
        el.addEventListener("ended", function () {
          const { at: playStartedAt, from: playStartedFrom } = playWindows.get(el);
          const remaining = (isFinite(el.duration) ? el.duration : 0) - playStartedFrom;
          if (
            remaining > INSTANT_END_MIN_REMAINING_S &&
            performance.now() - playStartedAt < INSTANT_END_MS
          ) {
            const label = audio?.name || audio?.src || "audio";
            message.error(
              `Could not decode ${label}: it ended as soon as it started. The file may be damaged or not really the format its name suggests (e.g. an MP4 saved as .mp3). Re-export it as MP3/WAV and upload again.`,
            );
            stopAudio(audio);
            el.currentTime = 0;
            return;
          }
          if (audio.loop) {
            if (looper.isActive(el)) {
              // The voice is carrying the loop seamlessly; the muted element
              // only keeps time, so put its clock back on the voice's.
              el.currentTime = looper.position(el) ?? 0;
            } else {
              el.currentTime = 0;
              // First pass after the decode finished: let the voice take
              // over here, at the seam, so every later pass is gapless.
              takeOverLoop(audio, el, 0);
            }
            el.play();
          } else {
            stopAudio(audio);
            el.currentTime = 0;
          }
        });
        el.addEventListener("loadedmetadata", function () {
          stageStore.UPDATE_AUDIO_PLAYER_STATUS({
            index: indexOf(audio),
            duration: el.duration,
          });
          prepareLoop(audio, el);
        });
        // A looping voice mirrors the element's level (per-track volume,
        // master volume and every fade are all animated on `el.volume`)
        // and its rate (replay speed).
        el.addEventListener("volumechange", function () {
          looper.setVolume(el, el.volume);
        });
        el.addEventListener("ratechange", function () {
          looper.setRate(el, el.playbackRate);
        });
        el.addEventListener("timeupdate", function () {
          stageStore.UPDATE_AUDIO_PLAYER_STATUS({
            index: indexOf(audio),
            currentTime: el.currentTime,
          });
        });
        el.addEventListener("error", function () {
          const label = audio?.name || audio?.src || "audio";
          message.error(
            `Could not play ${label}. This format may not be supported in your browser.`,
          );
          stopAudio(audio);
        });
      }
    };

    const fadeVolume = (audio, volume, duration = 1000) => {
      animate(audio, {
        volume,
        duration,
        ease: "linear",
      });
    };

    const speed = computed(() => {
      if (stageStore.replay.isReplaying) {
        return Math.min(stageStore.replay.speed, 8);
      }
      return 1;
    });

    const handleAudioChange = () => {
      audios.forEach((audio) => {
        if (audio.changed) {
          const el = elementFor.get(audio);
          // The element mounts on the render after the track is added;
          // leave `changed` set so the next watcher pass applies it.
          if (!el) return;
          if (audio.isPlaying) {
            el.playbackRate = speed.value;
            el.play();
          } else {
            el.pause();
          }
          if (audio.saken) {
            el.currentTime = audio.currentTime ?? 0;
            // The undecodable-file check measures "how much was left when
            // this run began". A seek moves that point: without this, Play
            // followed within INSTANT_END_MS by a seek to just before the
            // end reported a healthy file as "could not decode" (reproduced
            // in Chromium 2026-09-21). Only OUR seeks count — a broken file
            // jumping to its own end never passes through here.
            const playWindow = playWindows.get(el);
            if (playWindow) playWindow.from = el.currentTime;
          }
          prepareLoop(audio, el);
          if (audio.isPlaying && audio.loop) {
            // (Re)start the voice on a seek, or take over if it is not
            // sounding yet; otherwise leave a running voice untouched so
            // volume/loop-flag echoes cannot put a seam into it.
            if (audio.saken || !looper.isActive(el)) takeOverLoop(audio, el, el.currentTime);
          } else {
            // (A seek in the same update already put the element where it belongs.)
            releaseLoop(el, { resync: audio.isPlaying && !audio.saken });
          }
          fadeVolume(el, (audio.volume ?? 1) * stageStore.masterAudioVolume);
          audio.changed = false;
          audio.saken = false;
        }
      });
    };

    // Master volume / "fade out all" — re-apply the global level to every
    // element over the fade duration carried by the signal. Replacing the
    // signal object (in the store) guarantees this fires on each change.
    const applyMasterVolume = (sig) => {
      audios.forEach((audio) => {
        const el = elementFor.get(audio);
        if (!el) return;
        fadeVolume(el, (audio.volume ?? 1) * sig.volume, sig.duration);
      });
    };

    watch(audios, handleAudioChange);
    watch(() => stageStore.masterAudioSignal, applyMasterVolume);
    onMounted(handleAudioChange);
    onBeforeUnmount(() => looper.dispose());

    return { audios, setRef };
  },
};
</script>

<template>
  <!--
    Bind the asset URL directly to the <audio> element. Previously this
    template wrapped four <source> tags with mismatched MIME types
    (audio/mpeg, audio/ogg, audio/wav, audio/x-aiff) all pointing at the
    SAME `audio.src` URL. That produced misleading hints across browsers:
    Safari, which doesn't decode Vorbis/Opus, would accept the audio/mpeg
    hint, fetch the URL, fail to decode, then walk the same URL three
    more times under different `type` hints — net effect: silently broken
    on Safari for non-MP3/WAV uploads.

    The <object>/<embed>/<param> fallback targeted the Netscape Plugin
    API, which has been removed from every modern browser since ~2018,
    so it was dead code. We now let the browser sniff the format from
    the response Content-Type — works uniformly in Chromium / Firefox /
    Safari for any container the browser can decode natively.
  -->
  <audio
    v-for="audio in audios"
    :key="audio"
    :ref="(el) => setRef(el, audio)"
    :src="audio.src"
    preload="auto"
  />
</template>

<style scoped>
audio {
  display: none;
}
</style>
