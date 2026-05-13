<script>
// Aliased: "Object" is a reserved HTML element name (vue/no-reserved-component-names).
import AppObject from "../Object.vue";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { useUserStore } from "@stores/pinia/user";
import { useJitsiEndpoint } from "./composable";

// Embed the Jitsi room as a direct <iframe> rather than via the
// JitsiMeetExternalAPI script. Two reasons:
//
//  1. The external_api.min.js script was loaded from `meet.jit.si` and
//     was routinely blocked by Brave Shields, Firefox Strict ETP, and
//     content blockers — leaving `window.JitsiMeetExternalAPI`
//     undefined and crashing this component with a ReferenceError on
//     mount.
//
//  2. Setting the iframe's `allow=` Permissions Policy attribute is the
//     only reliable way to enforce the audience-vs-performer role
//     boundary at the browser level: the External API created the
//     iframe internally and the `allow` attribute was set too late to
//     take effect. With a direct <iframe> we set `allow=` on the
//     element from the start, which means audience members literally
//     cannot acquire camera / microphone inside the embedded meeting
//     even if a Jitsi UI control somehow surfaces. Performers get full
//     delegation so their controls actually work.
//
// The previous code only ever called `console.log(api)` after creation
// — no `executeCommand`, no `addEventListener` — so removing the
// External API does not lose any feature.

const TIMEOUT_MS = 15000;

// Translate a value into its URL-fragment-safe Jitsi config encoding.
// Jitsi parses fragment params as JS literals, so booleans/arrays/etc.
// must be JSON-serialised, then URI-encoded so `=`/`&`/etc. inside an
// array literal don't break the fragment grammar.
const encodeConfigValue = (v) => encodeURIComponent(JSON.stringify(v));

export default {
  components: { AppObject },
  props: { object: Object },
  setup: (props) => {
    const stageStore = useStageStore();
    const userStore = useUserStore();
    const meeting = computed(() => props.object);

    const canPlay = computed(() => stageStore.canPlay);
    const loading = ref(true);
    const failed = ref(false);
    let loadTimer = null;

    // Build the Jitsi room URL with role-aware in-fragment config:
    //  - Performers get the full Jitsi toolbar; they can toggle their
    //    own camera/mic during the meeting. Joining muted+cameraless
    //    is preserved (matches the prior `startVideoMuted/startAudioMuted`
    //    + `disableInitialGUM` behaviour).
    //  - Audience get an empty toolbar, no shortcuts, and
    //    `disableInitialGUM` so the iframe never attempts to access
    //    their devices. Even if the toolbar somehow rendered, the
    //    iframe's `allow=` attribute (below) does not delegate the
    //    `camera` / `microphone` Permissions-Policy features to them,
    //    so getUserMedia inside the iframe would fail at the browser
    //    boundary.
    const iframeSrc = computed(() => {
      const endpoint = useJitsiEndpoint();
      if (!endpoint) return "";
      const { host, httpScheme } = endpoint;

      const config = {
        prejoinPageEnabled: false,
        startVideoMuted: 1,
        startAudioMuted: 1,
        disableInitialGUM: !canPlay.value,
        ...(canPlay.value
          ? {}
          : {
              // Modern Jitsi key (>= 2.0.x).
              toolbarButtons: [],
              disableShortcuts: true,
              readOnlyName: true,
            }),
      };
      const interfaceConfig = {
        SHOW_CHROME_EXTENSION_BANNER: false,
        ...(canPlay.value
          ? {}
          : {
              // Legacy interfaceConfig key (older Jitsi installs).
              TOOLBAR_BUTTONS: [],
              SETTINGS_SECTIONS: [],
              MOBILE_APP_PROMO: false,
            }),
      };

      const fragmentParts = [
        ...Object.entries(config).map(([k, v]) => `config.${k}=${encodeConfigValue(v)}`),
        ...Object.entries(interfaceConfig).map(
          ([k, v]) => `interfaceConfig.${k}=${encodeConfigValue(v)}`,
        ),
        `userInfo.displayName=${encodeURIComponent(userStore.chatname || "Guest")}`,
      ];
      if (userStore.user?.email) {
        fragmentParts.push(`userInfo.email=${encodeURIComponent(userStore.user.email)}`);
      }

      const room = encodeURIComponent(props.object.name);
      return `${httpScheme}://${host}/${room}#${fragmentParts.join("&")}`;
    });

    // Permissions Policy delegation. Performer iframes get full media
    // access; audience iframes get only `autoplay` so the rendered
    // <video>/<audio> playback works without a user gesture but the
    // iframe cannot acquire camera/mic. `display-capture` covers the
    // optional screen-sharing button on the performer toolbar.
    const iframeAllow = computed(() =>
      canPlay.value ? "camera; microphone; display-capture; autoplay" : "autoplay",
    );

    const onLoad = () => {
      loading.value = false;
      if (loadTimer) {
        clearTimeout(loadTimer);
        loadTimer = null;
      }
    };
    const onError = () => {
      failed.value = true;
      loading.value = false;
      if (loadTimer) {
        clearTimeout(loadTimer);
        loadTimer = null;
      }
    };

    onMounted(() => {
      // Some content blockers (e.g. uBlock Origin in cosmetic mode)
      // serve a blank document into the iframe rather than firing
      // `error`. Fall back to a "service unavailable" message after a
      // generous timeout so the user is not stuck on the spinner.
      loadTimer = setTimeout(() => {
        if (loading.value) {
          failed.value = true;
          loading.value = false;
        }
      }, TIMEOUT_MS);
    });

    onUnmounted(() => {
      if (loadTimer) clearTimeout(loadTimer);
    });

    const activeMovable = computed(() => stageStore.activeMovable);

    return {
      meeting,
      activeMovable,
      iframeSrc,
      iframeAllow,
      loading,
      failed,
      onLoad,
      onError,
      canPlay,
    };
  },
};
</script>

<template>
  <div>
    <AppObject :object="meeting">
      <template #render>
        <div
          id="meeting-room"
          class="frame"
          :style="{ width: object.w + 'px', height: object.h + 'px' }"
          :class="activeMovable ? 'disable-pointer' : ''"
        >
          <!--
            Use the same small spinner GIF as the individual-stream tile
            (Yourself.vue / Jitsi.vue). The previous `<Loading />` here
            rendered `/img/loading.svg` at `height: 100%`, which briefly
            painted a giant orange/cream striped square over the whole
            meeting before the iframe finished loading.
          -->
          <img v-if="loading" class="overlay" src="/img/videoloading.gif" />
          <div v-if="failed" class="failed">
            <p><strong>Embedded meeting service is unavailable.</strong></p>
            <p class="hint">
              If you have a content blocker enabled (Brave Shields, uBlock Origin, Privacy Badger,
              Firefox Strict tracking protection, etc.), allow this page to embed
              <code>{{ iframeSrc.split("/")[2] }}</code> and refresh.
            </p>
          </div>
          <iframe
            v-show="!failed"
            class="room"
            :src="iframeSrc"
            :allow="iframeAllow"
            allowfullscreen
            referrerpolicy="no-referrer-when-downgrade"
            @load="onLoad"
            @error="onError"
          />
        </div>
      </template>
    </AppObject>
  </div>
</template>

<style lang="scss" scoped>
.frame {
  position: relative;
  border: 2px solid black;
  border-top: 10px solid #007011;
  border-radius: 8px;
  box-sizing: border-box;
  overflow: hidden;

  .room {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }
}

.disable-pointer {
  pointer-events: none;
}

// Mirrors the overlay rule in Yourself.vue / Jitsi.vue so the
// buffering animation lands in the centre of the tile rather than
// covering the whole iframe.
.overlay {
  position: absolute;
  width: 40%;
  left: 30%;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  pointer-events: none;
}

.failed {
  padding: 16px;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  text-align: center;
  background-color: #fdedf6;

  .hint {
    font-size: 0.85rem;
    margin-top: 8px;
    code {
      font-family: monospace;
      background-color: rgba(0, 0, 0, 0.06);
      padding: 1px 4px;
      border-radius: 3px;
    }
  }
}
</style>
