<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch, watchEffect } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { animate } from "animejs";
import { useAttribute } from "services/graphql/composable";

const stageStore = useStageStore();
const preloading = computed<boolean>(() => stageStore.preloading);
const preloadableAssets = computed<string[]>(() => stageStore.preloadableAssets);
const model = computed(() => stageStore.model);
const progress = ref<number>(0);
watch(
  () => model.value?.id,
  () => {
    progress.value = 0;
  },
);
const stopLoading = () => stageStore.SET_PRELOADING_STATUS(false);
const increaseProgress = () => {
  progress.value++;
  if (
    progress.value === preloadableAssets.value.length ||
    progress.value === preloadableAssets.value.length - 1
  ) {
    stopLoading();
  }
};
watchEffect(() => {
  if (preloadableAssets.value.length === 0 && model.value) {
    stopLoading();
  }
});

watch(
  preloading,
  (val) => {
    const logo = document.querySelector("#live-logo");
    if (logo) {
      if (val) logo.classList.add("preloader");
      else logo.classList.remove("preloader");
    }
  },
  { immediate: true },
);

// `ListStage` includes `status` on the stage payload; the attributes array can lag
// or duplicate it — prefer the root field from `loadStage`, then `attributes`.
const statusFromAttributes = useAttribute(model, "status");
const status = computed(() => model.value?.status ?? statusFromAttributes.value ?? "rehearsal");
const timer = ref<ReturnType<typeof setTimeout>>();
watch(model, (val) => {
  if (val && status.value === "live") {
    timer.value = setTimeout(stopLoading, 60000);
  }
});
onUnmounted(() => {
  if (timer.value) clearTimeout(timer.value);
});

const replaying = inject<boolean>("replaying");
// `stageStore.ready` is `StageModel | null && !preloading`, i.e.
// `StageModel | false | null` — coerce to a plain boolean for the
// `v-if` check below.
const ready = computed<boolean>(() => !!stageStore.ready);
const clicked = ref<boolean>(false);
const leave = (el: Element, complete: () => void) => {
  animate(el as HTMLElement, {
    translateY: "-100%",
    ease: "outBack",
    onComplete: complete,
  });
};
const backdropColor = computed<string>(() => stageStore.backdropColor);
// `canPlay` includes the model permission check, which can yield a
// truthy string (`"owner"`/`"editor"`/etc.) before the final
// `!== "audience"` step — coerce to a proper boolean.
const canPlay = computed<boolean>(() => !!stageStore.canPlay);
const masquerading = computed<boolean>(() => stageStore.masquerading);
</script>

<template>
  <transition @leave="leave">
    <section
      v-if="!ready || !clicked || (status !== 'live' && !canPlay && !masquerading)"
      class="hero is-fullheight is-fullwidth cover-image"
      :class="{ replaying }"
      :style="{
        'background-image': model
          ? `url(&quot;${model.cover || '/img/greencurtain.jpg'}&quot;)`
          : undefined,
        'background-color': backdropColor,
      }"
      @click="clicked = true"
    >
      <div class="hero-body">
        <div class="container">
          <template v-if="model">
            <h1 class="title" :class="{ 'mb-0': model.description }">
              {{ model.name }}
            </h1>
            <h2 v-if="model.description" class="subtittle">
              {{ model.description }}
            </h2>
            <!--
              Hidden preload must mount whenever we have assets, independent of the
              status/ready branch below. Otherwise `status !== 'live' && !canPlay` renders
              the "closed" copy but skips the v-else block — no imgs mount, @load never
              fires, and preloading/ready never clear (infinite "loading").
            -->
            <div v-if="preloadableAssets.length" id="preloading-area" aria-hidden="true">
              <img
                v-for="(src, idx) in preloadableAssets"
                :key="`${idx}-${src}`"
                :src="src"
                @load="increaseProgress"
                @error="increaseProgress"
              />
            </div>
            <template v-if="replaying && (!model.events || model.events.length === 0)">
              <h2 class="subtitle">{{ $t("replay_no_events_title") }}</h2>
              <p>{{ $t("replay_no_events_body") }}</p>
            </template>
            <template v-else-if="status !== 'live' && !canPlay && !replaying">
              <span v-if="status" class="tag is-dark">{{ status.toUpperCase() }}</span
              >&nbsp;
              <span>This stage is not currently open to the public. Please come back later!</span>
            </template>
            <h2 v-else-if="ready" class="subtitle">
              <span class="sparkle" style="line-height: 2"
                >Stage loaded 100%, click anywhere to continue...</span
              >
            </h2>
            <h2 v-else class="subtitle">
              <template v-if="preloadableAssets.length">
                <button class="button is-primary is-loading" />
                <span style="line-height: 2">
                  <span> Preloading media... {{ progress }}/{{ preloadableAssets.length }} </span>
                </span>
              </template>
            </h2>
          </template>
          <template v-else-if="preloading">
            <h2 class="subtitle">
              <button class="button is-primary is-loading" />
              <span style="line-height: 2">Loading stage information...</span>
            </h2>
          </template>
          <template v-else>
            <h1 class="title">Stage not found!</h1>
            <span>Are you sure the stage url is correct?</span>
          </template>
        </div>
      </div>
    </section>
  </transition>
</template>

<style scoped lang="scss">
#preloading-area {
  width: 0px;
  height: 0px;
  overflow: hidden;
}

section {
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  text-shadow: black 0px 0px 3px;
  position: absolute;
  z-index: 20000;

  * {
    color: white;
  }

  button {
    background-color: transparent !important;
  }

  &.replaying {
    background-color: #363636;
  }
}

.sparkle {
  animation: sparkle 1s infinite;
}

@keyframes sparkle {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}
</style>
