<script>
import { computed, onUnmounted, reactive, watch } from "vue";
import { animate } from "animejs";
import { useStageStore } from "@stores/pinia/stage";
import { CURTAIN_RUN, createFrameCycle, layerCycleMs } from "@utils/frameAnimation";
export default {
  setup: () => {
    const stageStore = useStageStore();
    const canPlay = computed(() => stageStore.canPlay);
    const curtain = computed(() => stageStore.curtain);
    const config = computed(() => stageStore.config);
    const curtainSpeed = computed(() => config.value?.animations?.curtainSpeed ?? 9100);

    // Multi-frame state. Mirrors `Backdrop.vue`: when a multi-frame curtain
    // is active and `speed > 0` it cycles through `frames`, one step every
    // fade (`speed`) + hold (`dwell`) seconds. The CSS `transition: opacity`
    // on `.frame-fade-*` (bound to `frameFadeDuration`) runs for `speed`
    // seconds; `dwell` is the time the new frame then sits at full opacity.
    //
    // The frame is worked out from how long ago the cycle started
    // (`stageStore.frameRuns`, see FrameRun in @utils/frameAnimation), so
    // audience members joining mid-rotation land on the same picture the
    // performer is showing and change with them (#1582). Every accepted
    // curtain change restarts the cycle (`syncCurtainFrameRun` in the store).
    const frameAnimation = reactive({
      currentFrame: null,
    });

    let localRun = null;
    const isAnimating = (c) =>
      Boolean(c?.multi && c.frames?.length) && (c.speed ?? 0) > 0 && layerCycleMs(c) > 0;
    const currentRun = () => {
      const c = curtain.value;
      if (!isAnimating(c)) return null;
      const shared = stageStore.frameRuns?.[CURTAIN_RUN];
      if (shared) return shared;
      // No record in the store (it always has one): start when first seen.
      if (!localRun) {
        localRun = {
          key: "local",
          token: -1,
          startedAt: Date.now(),
          fromFrame: c.currentFrame || c.frames[0],
        };
      }
      return localRun;
    };
    const cycle = createFrameCycle({
      getState: () => {
        const run = currentRun();
        if (!run) return null;
        const c = curtain.value;
        return {
          frames: c.frames,
          frameLoop: c.frameLoop,
          intervalMs: layerCycleMs(c),
          startedAt: run.startedAt,
          fromFrame: run.fromFrame,
        };
      },
      onFrame: (frame) => {
        frameAnimation.currentFrame = frame;
      },
      onFinished: (frame) => {
        const c = stageStore.curtain;
        if (!c?.frames?.length) return;
        stageStore.drawCurtain({
          ...c,
          speed: 0,
          lastSpeed: c.lastSpeed ?? c.speed ?? 0.5,
          currentFrame: frame ?? c.frames[c.frames.length - 1],
        });
      },
    });

    watch(
      [curtain, () => stageStore.frameRuns?.[CURTAIN_RUN]?.token],
      ([value]) => {
        cycle.stop();
        localRun = null;
        if (!value) {
          frameAnimation.currentFrame = null;
          return;
        }
        const { src, multi, frames, currentFrame } = value;
        if (currentFrame) {
          frameAnimation.currentFrame = currentFrame;
        } else if (multi && frames && frames.length) {
          frameAnimation.currentFrame = frames[0];
        } else {
          frameAnimation.currentFrame = src ?? null;
        }
        if (isAnimating(value)) cycle.sync();
      },
      { immediate: true },
    );

    // Timers are slowed or paused in a hidden tab; catch up at once when the
    // stage is looked at again.
    const onVisible = () => {
      if (!document.hidden && cycle.running()) cycle.sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    onUnmounted(() => {
      document.removeEventListener("visibilitychange", onVisible);
      cycle.stop();
    });

    // Single URL the <img> tag reads. Falls back to the curtain's `src`
    // when there's no active frame (single-image curtain, or before the
    // first interval tick).
    const displaySrc = computed(() => frameAnimation.currentFrame ?? curtain.value?.src ?? null);

    // Crossfade duration for multi-frame swaps. Mirrors Backdrop.vue,
    // which threads `background.speed * 1000` through to AppImage's
    // `transition` prop — making each fade complete just as the next
    // interval tick fires, so the audience sees a continuous crossfade
    // rather than a hard cut. Falls back to 0 (no transition) for
    // single-image curtains where `speed` is meaningless.
    const frameFadeMs = computed(() => {
      const s = parseFloat(String(curtain.value?.speed ?? 0));
      return Number.isFinite(s) && s > 0 ? s * 1000 : 0;
    });
    const frameFadeDuration = computed(() => `${frameFadeMs.value / 1000}s`);

    const curtainEnter = (el, complete) => {
      const duration = curtainSpeed.value;
      switch (config.value?.animations?.curtain) {
        case "fade":
          animate(el, {
            opacity: [0, 1],
            duration,
            onComplete: complete,
          });
          break;
        case "close":
          el.style.transformOrigin = "0 0";
          animate(el, {
            scaleX: [0, 1],
            duration,
            onComplete: complete,
          });
          break;
        default:
          animate(el, {
            scaleY: [0, 1],
            duration,
            onComplete: complete,
          });
      }
    };
    const curtainLeave = (el, complete) => {
      const duration = curtainSpeed.value;
      switch (config.value?.animations?.curtain) {
        case "fade":
          animate(el, {
            opacity: [1, 0],
            duration,
            onComplete: complete,
          });
          break;
        case "close":
          el.style.transformOrigin = "0 0";
          animate(el, {
            scaleX: [1, 0],
            duration,
            onComplete: complete,
          });
          break;
        default:
          animate(el, {
            scaleY: 0,
            duration,
            onComplete: complete,
          });
      }
    };

    const dualCurtain = computed(() => config.value?.animations?.curtain === "close");

    const dualCurtainEnter = (el, complete) => {
      const duration = curtainSpeed.value;
      el.style.transformOrigin = "100% 0";
      animate(el, {
        scaleX: [0, 1],
        duration,
        onComplete: complete,
      });
    };

    const dualCurtainLeave = (el, complete) => {
      const duration = curtainSpeed.value;
      el.style.transformOrigin = "100% 0";
      animate(el, {
        scaleX: [1, 0],
        duration,
        onComplete: complete,
      });
    };

    return {
      canPlay,
      curtain,
      displaySrc,
      frameFadeDuration,
      curtainEnter,
      curtainLeave,
      dualCurtain,
      dualCurtainEnter,
      dualCurtainLeave,
    };
  },
};
</script>

<!--
  Two layers of transitions per curtain panel:
    * Outer <transition> (animejs): controls curtain show/hide
      (scale/fade/slide). Operates on the wrapping <div>.
    * Inner <transition name="frame-fade">: keyed on `displaySrc`, so
      each frame swap of a multi-frame curtain runs a CSS opacity
      crossfade rather than a hard cut. Mirrors Backdrop.vue, which
      gets the same effect for free from AppImage's internal fade.
-->
<template>
  <div :style="{ opacity: canPlay ? 0.5 : 1 }">
    <transition @enter="curtainEnter" @leave="curtainLeave">
      <div v-if="curtain && displaySrc" class="curtain" :class="{ 'dual-left': dualCurtain }">
        <transition name="frame-fade">
          <img :key="displaySrc" :src="displaySrc" class="curtain-img" />
        </transition>
      </div>
    </transition>
    <transition @enter="dualCurtainEnter" @leave="dualCurtainLeave">
      <div v-if="dualCurtain && curtain && displaySrc" class="curtain dual-right">
        <transition name="frame-fade">
          <img :key="displaySrc" :src="displaySrc" class="curtain-img" />
        </transition>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.curtain {
  pointer-events: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  transform-origin: top;
  overflow: hidden;
}
.curtain-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.dual-left {
  width: 50vw;
}
.dual-right {
  width: 50vw;
  left: 50vw;
}

/*
  Frame-to-frame crossfade for multi-frame curtains. The leaving image
  stays positioned (absolute/inset) underneath the new one as both
  fade — matches the behaviour AppImage gives Backdrop for free.
  Duration is driven from the curtain's per-frame `speed` so the fade
  finishes exactly when the next setInterval tick fires.
*/
.frame-fade-enter-active,
.frame-fade-leave-active {
  transition: opacity v-bind(frameFadeDuration);
}
.frame-fade-enter-from,
.frame-fade-leave-to {
  opacity: 0;
}
</style>
