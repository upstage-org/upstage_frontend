<script>
// Aliased: "Object" is a reserved HTML element name (vue/no-reserved-component-names).
import AppObject from "../Object.vue";
import { computed, createVNode, onMounted, onUnmounted, ref, watch } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { useUserStore } from "@stores/pinia/user";
import { useJitsiEndpoint } from "./composable";
import { Modal } from "ant-design-vue";
import { useI18n } from "vue-i18n";

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
// Current Jitsi Meet parses fragment values with JSON.parse(), so strings
// must still be JSON.stringify'd (quotes + escaping), not passed raw.
// URI-encode afterward so `=`/`&`/etc. inside literals don't break the
// fragment grammar.
const encodeConfigValue = (v) => encodeURIComponent(JSON.stringify(v));

/**
 * Jitsi `config` / `interfaceConfig` overrides for audience viewers
 * (`stageStore.canPlay === false`: guest, audience permission, replay,
 * masquerade). Goal: join muted, watch only — no flip, pin-to-stage,
 * participant menus, reactions, profile, or share/embed affordances.
 * Performers omit this block and keep the server defaults.
 */
const AUDIENCE_JITSI_CONFIG = {
  toolbarButtons: [],
  disableShortcuts: true,
  readOnlyName: true,
  disableDeepLinking: true,
  disableInviteFunctions: true,
  disableProfile: true,
  disableReactions: true,
  disableReactionsInChat: true,
  disableModeratorIndicator: true,
  disableRemoteMute: true,
  disableSelfView: true,
  disableSelfViewSettings: true,
  disableLocalVideoFlip: true,
  hiddenPremeetingButtons: ["microphone", "camera", "select-background", "invite", "settings"],
  filmstrip: {
    disableResizable: true,
    disableStageFilmstrip: true,
  },
  remoteVideoMenu: {
    disabled: true,
    disableKick: true,
    disableGrantModerator: true,
    disablePrivateChat: "all",
    disableDemote: true,
  },
  participantsPane: {
    hideModeratorSettingsTab: true,
    hideMoreActionsButton: true,
    hideMuteAllButton: true,
  },
};

const AUDIENCE_JITSI_INTERFACE_CONFIG = {
  TOOLBAR_BUTTONS: [],
  SETTINGS_SECTIONS: [],
  MOBILE_APP_PROMO: false,
  SHARING_FEATURES: [],
  DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
};

export default {
  components: { AppObject },
  props: { object: Object },
  setup: (props) => {
    const stageStore = useStageStore();
    const userStore = useUserStore();
    const meeting = computed(() => props.object);

    const canPlay = computed(() => stageStore.canPlay);
    const { t } = useI18n();
    const loading = ref(true);
    const failed = ref(false);
    let loadTimer = null;

    // Build the Jitsi room URL with role-aware in-fragment config:
    //  - Performers get the full Jitsi toolbar; they can toggle their
    //    own camera/mic during the meeting. Joining muted+cameraless
    //    is preserved (matches the prior `startVideoMuted/startAudioMuted`
    //    + `disableInitialGUM` behaviour).
    //  - Audience: see AUDIENCE_JITSI_* below — watch-only (no flip, pin,
    //    participant menus, reactions, etc.), `disableInitialGUM`, no
    //    `allowfullscreen`. Performers keep full Jitsi UI + allow= media.
    const iframeSrc = computed(() => {
      const endpoint = useJitsiEndpoint();
      if (!endpoint) return "";
      const { host, httpScheme } = endpoint;

      const config = {
        // Auto-join: the legacy flat key was renamed upstream to
        // `prejoinConfig.enabled`; current Jitsi Meet ignores
        // `prejoinPageEnabled` and shows its prejoin ("Join meeting")
        // screen inside the tile, which reads as the meeting failing to
        // connect. Send both spellings so old and new web UIs auto-join
        // (verified against streaming.upstage.live with
        // tests/e2e/scripts/meet-connect-probe.mjs, 2026-08-14).
        prejoinPageEnabled: false,
        prejoinConfig: { enabled: false },
        startVideoMuted: 1,
        startAudioMuted: 1,
        disableInitialGUM: !canPlay.value,
        ...(canPlay.value ? {} : AUDIENCE_JITSI_CONFIG),
      };
      const interfaceConfig = {
        SHOW_CHROME_EXTENSION_BANNER: false,
        ...(canPlay.value ? {} : AUDIENCE_JITSI_INTERFACE_CONFIG),
      };

      const fragmentParts = [
        ...Object.entries(config).map(([k, v]) => `config.${k}=${encodeConfigValue(v)}`),
        ...Object.entries(interfaceConfig).map(
          ([k, v]) => `interfaceConfig.${k}=${encodeConfigValue(v)}`,
        ),
        `userInfo.displayName=${encodeConfigValue(userStore.chatname || "Guest")}`,
      ];
      if (userStore.user?.email) {
        fragmentParts.push(`userInfo.email=${encodeConfigValue(userStore.user.email)}`);
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
      // Self-heal: on a slow network the TIMEOUT_MS fallback below can flip
      // `failed` BEFORE the (multi-MB) Jitsi web bundle finishes loading.
      // Without clearing it here the meeting stays hidden behind the
      // "service is unavailable" card forever even though the iframe is
      // fine — clear it the moment the document actually loads.
      failed.value = false;
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

    // Some content blockers (e.g. uBlock Origin in cosmetic mode)
    // serve a blank document into the iframe rather than firing
    // `error`. Fall back to a "service unavailable" message after a
    // generous timeout so the user is not stuck on the spinner.
    const startLoadTimer = () => {
      if (loadTimer) clearTimeout(loadTimer);
      loadTimer = setTimeout(() => {
        loadTimer = null;
        if (loading.value) {
          failed.value = true;
          loading.value = false;
        }
      }, TIMEOUT_MS);
    };

    onMounted(startLoadTimer);

    onUnmounted(() => {
      if (loadTimer) clearTimeout(loadTimer);
    });

    const activeMovable = computed(() => stageStore.activeMovable);

    // Remounting the iframe = leaving and re-joining the Jitsi room. For a
    // performer that means their camera/mic come back in the room's
    // start-muted state and every other participant sees them drop out and
    // return without video. So a remount is ONLY ever done locally, in this
    // browser, and ONLY when the embed failed to load (blocked / timed out) —
    // never against a meeting that is up and joined. Nothing here is sent
    // over MQTT; other browsers are unaffected.
    const iframeKey = ref(0);
    const remountIframe = () => {
      loading.value = true;
      failed.value = false;
      iframeKey.value += 1;
      startLoadTimer();
    };

    // In-tile "Refresh meeting" button on the failed card.
    const retryMeeting = () => remountIframe();

    // Topbar "Refresh streams" button (ReloadStream.vue → refreshMeeting()):
    //  - failed embed: always reload (any role).
    //  - audience (!canPlay): always reload. Their iframe has no camera/mic
    //    delegation, so a remount is a harmless rejoin-as-viewer and gives
    //    a real "refresh" for a frozen meeting picture.
    //  - performer with a (seemingly) loaded meeting: we can't tell from
    //    outside the iframe whether the meeting is really working, so offer
    //    a force-reload behind a confirmation. A remount leaves the room
    //    (the performer drops out for everyone) and rejoins with webcam/mic
    //    muted, so it must be an explicit choice.
    watch(
      () => stageStore.meetingRefreshKey,
      () => {
        if (failed.value || !canPlay.value) {
          remountIframe();
          return;
        }
        Modal.confirm({
          title: t("refresh_meeting"),
          content: createVNode(
            "div",
            { style: "color: black; white-space: pre-line;" },
            t("refresh_meeting_force_confirm"),
          ),
          okText: t("refresh_meeting"),
          okButtonProps: { danger: true },
          onOk() {
            remountIframe();
          },
        });
      },
    );

    return {
      meeting,
      activeMovable,
      iframeSrc,
      iframeAllow,
      loading,
      failed,
      iframeKey,
      onLoad,
      onError,
      canPlay,
      retryMeeting,
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
              <code>{{ iframeSrc.split("/")[2] }}</code> and try again.
            </p>
            <button class="button is-small is-light" type="button" @click="retryMeeting">
              {{ $t("refresh_meeting") }}
            </button>
          </div>
          <iframe
            v-show="!failed"
            :key="iframeKey"
            class="room"
            :src="iframeSrc"
            :allow="iframeAllow"
            :allowfullscreen="canPlay"
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
