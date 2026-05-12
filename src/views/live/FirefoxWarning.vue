<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { animate } from "animejs";
import Icon from "components/Icon.vue";
import Modal from "components/Modal.vue";
import Copy from "components/Copy.vue";
import { useStageStore } from "@stores/pinia/stage";

const publicPath = "/";
const stageStore = useStageStore();

/**
 * The original warning addressed Firefox bug 1492471: when an HTTP/2
 * connection was upgraded to WebSocket on a server that also advertised
 * SPDY, Firefox dropped frames silently. Toggling `network.http.spdy.websockets`
 * to `false` worked around it. Mozilla removed the SPDY-over-WebSocket
 * code path entirely in Firefox 88 (May 2021), and the preference no
 * longer exists in `about:config`. Showing this dialog to a Firefox 88+
 * user is therefore actively misleading — they search the pref, find
 * nothing, and lose trust in our diagnostics.
 *
 * We:
 *   1. Tighten UA detection to *desktop* Firefox only. The previous
 *      `indexOf("Firefox")` matched Tor Browser (fine), Iceweasel
 *      (fine), Firefox iOS (which actually runs WebKit underneath and
 *      doesn't have this bug), and Firefox for Android (uses GeckoView
 *      and isn't affected).
 *   2. Parse the version number out of the UA. The warning is only
 *      shown for Firefox < 88 — the user population this preference
 *      can still help.
 */
const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
const firefoxMatch = /(?<!FxiOS\/[\d.]+\s)Firefox\/(\d+)/.exec(ua);
const isMobileFirefox = /FxiOS|Mobile|Tablet/.test(ua);
const firefoxMajor = firefoxMatch && !isMobileFirefox ? Number(firefoxMatch[1]) : null;
const isFirefoxWithSpdyPref = firefoxMajor !== null && firefoxMajor < 88;

const status = computed<string>(() => stageStore.status);
const visible = computed<boolean>(
  () => isFirefoxWithSpdyPref && (status.value === "CONNECTING" || status.value === "OFFLINE"),
);
const open = ref(true);

// Animate the Firefox icon at most once every 3 seconds, but only while
// the warning is actually visible. The previous version started a
// `setInterval` at module-evaluation time on every browser (including
// Chromium / Safari users where `visible` is permanently false), which
// kept ticking forever for no reason.
const icon = ref<HTMLElement>();
let interval: ReturnType<typeof setInterval> | null = null;
const startAnimating = () => {
  if (interval !== null) return;
  interval = setInterval(() => {
    if (icon.value) {
      animate(icon.value, {
        scale: [1, 1.5, 1],
        rotate: [45, -45, 45, -45, 0],
        ease: "inOutQuad",
      });
    }
  }, 3000);
};
const stopAnimating = () => {
  if (interval !== null) {
    clearInterval(interval);
    interval = null;
  }
};
watch(visible, (v) => (v ? startAnimating() : stopAnimating()), { immediate: true });

onUnmounted(stopAnimating);
</script>

<template>
  <Modal v-if="visible" v-model="open">
    <template #trigger>
      <span class="tag is-small is-warning clickable" style="vertical-align: top">
        <span ref="icon" class="icon">
          <Icon src="firefox-logo.svg" />
        </span>
      </span>
    </template>
    <template #header>
      <Icon size="24" src="firefox-logo.svg" />&nbsp;Caution Firefox Users!
    </template>
    <template #content>
      <p>A Firefox setting needs to be changed to allow you to access UpStage on Firefox.</p>
      <div class="columns">
        <div class="column is-3 mt-6">
          <b>Step 1:</b>&nbsp;Open a new tab and go to
          <Copy value="about:config" />
        </div>
        <div class="column">
          <img :src="`${publicPath}/instruction/firefox/1.png`" alt="Step 1" />
          <div class="columns">
            <div class="column is-4 mt-6">
              <code>Note:</code>&nbsp;If you see this screen, click to continue. Don't worry, the
              setting change needed for UpStage to work will not impact on performance or security
              of Firefox.
            </div>
            <div class="column">
              <img :src="`${publicPath}/instruction/firefox/1.2.png`" alt="Step 1.2" />
            </div>
          </div>
        </div>
      </div>
      <div class="columns">
        <div class="column is-4 mt-6">
          <b>Step 2:</b>&nbsp;Search for
          <Copy value="network.http.spdy.websockets" />
        </div>
        <div class="column">
          <img :src="`${publicPath}/instruction/firefox/2.png`" alt="Step 2" />
        </div>
      </div>
      <div class="columns">
        <div class="column is-4 mt-6">
          <b>Step 3:</b>&nbsp;Change the value to
          <code>{{ "false" }}</code>
        </div>
        <div class="column">
          <img :src="`${publicPath}/instruction/firefox/3.png`" alt="Step 3" />
        </div>
      </div>
    </template>
  </Modal>
</template>

<style></style>
