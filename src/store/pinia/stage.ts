// @ts-nocheck
/**
 * Pinia `stage` store — Phase 5.3 scaffold (Wave A).
 *
 * Mirrors the public surface of `src/store/modules/stage/index.ts` (the
 * still-authoritative Vuex stage module) for **state + getters only**.
 * Mutations and actions are NOT in this file yet — they land in Wave B
 * (mutation bodies) and Wave C (action bodies). See `REMAINING_STEPS.md`
 * §3 for the full wave plan.
 *
 * Wave A is intentionally inert: this store is NOT exported from
 * `pinia/index.ts` and NOT exposed under `__UPSTAGE_PINIA__.stage`.
 * Nothing in the app reads from it yet. Its only job is to:
 *   1. Pin down the migration target's shape in Pinia idioms.
 *   2. Type-check + lint cleanly so subsequent waves have a stable base.
 *   3. Document name-collision resolutions between state and getters.
 *
 * **Name collisions** (Vuex allowed `state.x` and `getters.x` to coexist;
 * Pinia setup stores cannot). Resolution: the raw ref keeps the original
 * name as `_x`, and the public computed keeps the Vuex getter name `x`.
 * Mutations (Wave B) will write to `_x`; consumers will read `x`.
 *
 *   • Vuex `state.activeMovable`    → Pinia `_activeMovable` (ref)
 *     Vuex `getters.activeMovable`  → Pinia `activeMovable` (computed)
 *   • Vuex `state.config`           → Pinia `_config` (ref)
 *     Vuex `getters.config`         → Pinia `config` (computed)
 *   • Vuex `state.reloadStreams`    → Pinia `_reloadStreams` (ref)
 *     Vuex `getters.reloadStreams`  → Pinia `reloadStreams` (computed)
 *   • Vuex `state.enabledLiveStreaming`   → Pinia `_enabledLiveStreaming`
 *     Vuex `getters.enabledLiveStreaming` → Pinia `enabledLiveStreaming`
 *
 * All other state keys keep their Vuex names verbatim.
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { randomMessageColor } from "@utils/common";
import { getDefaultStageConfig, getDefaultStageSettings } from "@stores/modules/stage/reusable";
import { useUserStore } from "@stores/pinia/user";

export const useStageStore = defineStore("stage", () => {
  // ====================================================================
  // STATE — 1:1 port of the Vuex `state` object (src/store/modules/stage/index.ts L34-115)
  // ====================================================================

  const preloading = ref(true);
  const model = ref(null);
  const background = ref(null);
  const curtain = ref(null);
  const backdropColor = ref("gray");
  const chatPosition = ref("right");
  const status = ref("OFFLINE");
  const subscribeSuccess = ref(false);
  // Public-facing name is the `activeMovable` computed below; the raw ref
  // is the mutation target.
  const _activeMovable = ref(null);

  const chat = ref({
    messages: [],
    privateMessages: [],
    privateMessage: "",
    color: randomMessageColor(),
    opacity: 0.9,
    fontSize: "14px",
    playerFontSize: "14px",
  });

  const board = ref({
    objects: [],
    drawings: [],
    texts: [],
    whiteboard: [],
    tracks: [],
  });

  const tools = ref({
    avatars: [],
    props: [],
    backdrops: [],
    audios: [],
    streams: [],
    meetings: [],
    curtains: [],
  });

  const _config = ref(getDefaultStageConfig());
  const settings = ref(getDefaultStageSettings());
  const settingPopup = ref({ isActive: false });
  const preferences = ref({
    isDrawing: false,
    text: { fontSize: "20px", fontFamily: "Josefin Sans" },
  });
  const reactions = ref([]);
  // Static placeholder; the Wave-C port of reactiveViewport.ts will
  // start mutating this once App.vue mounts. Same TDZ-avoidance note
  // as the Vuex original — do not call getViewport() here.
  const viewport = ref({ width: 0, height: 0 });
  const sessions = ref([]);
  const session = ref(null);
  const replay = ref({
    timestamp: { begin: 0, end: 0, current: 0 },
    timers: [],
    interval: null,
    speed: 1,
  });
  const audioPlayers = ref([]);
  const isSavingScene = ref(false);
  const isLoadingScenes = ref(false);
  const showPlayerChat = ref(false);
  const showClearChatSetting = ref(false);
  const showDownloadChatSetting = ref(false);
  const lastSeenPrivateMessage = ref(localStorage.getItem("lastSeenPrivateMessage") ?? 0);
  const masquerading = ref(false);
  const purchasePopup = ref({ isActive: false });
  const receiptPopup = ref({
    isActive: false,
    donationDetails: { amount: 0, date: "" },
  });
  const _reloadStreams = ref(null);
  const _enabledLiveStreaming = ref(true);

  // ====================================================================
  // GETTERS — 1:1 port of the Vuex `getters` object (L116-228)
  // ====================================================================

  // ready: model loaded and preload finished
  const ready = computed(() => model.value && !preloading.value);

  const url = computed(() => (model.value ? model.value.fileLocation : "demo"));

  const objects = computed(() =>
    board.value.objects.map((o) => ({
      ...o,
      holder: sessions.value.find((s) => s.avatarId === o.id),
    })),
  );

  const config = computed(() => _config.value);

  const preloadableAssets = computed(() => {
    const assets = []
      .concat(tools.value.avatars.filter((a) => !a.multi).map((a) => a.src))
      .concat(
        tools.value.avatars
          .filter((a) => a.multi)
          .map((a) => a.frames ?? [])
          .flat(),
      )
      .concat(tools.value.props.filter((a) => !a.multi).map((p) => p.src))
      .concat(
        tools.value.props
          .filter((a) => a.multi)
          .map((a) => a.frames ?? [])
          .flat(),
      )
      .concat(tools.value.backdrops.filter((a) => !a.multi).map((b) => b.src))
      .concat(
        tools.value.backdrops
          .filter((a) => a.multi)
          .map((a) => a.frames ?? [])
          .flat(),
      )
      .concat(tools.value.curtains.map((b) => b.src));
    // Drop falsy so we never block on a slot that will never @load
    return assets.filter((src) => Boolean(src));
  });

  const audios = computed(() => tools.value.audios);

  // currentAvatar: matches Vuex getter, including the lazy
  // useUserStore() lookup to dodge the auth/user/stage import cycle.
  const currentAvatar = computed(() => {
    const id = useUserStore().avatarId;
    return board.value.objects.find((o) => o.id === id);
  });

  const activeMovable = computed(() => {
    if (masquerading.value) {
      return null;
    }
    return _activeMovable.value;
  });

  const stageSize = computed(() => {
    let width = viewport.value.width;
    let height = viewport.value.height;
    let left = 0;
    let top = 0;
    const ratio = config.value.ratio;
    if (width / height > ratio) {
      width = height * ratio;
      left = (window.innerWidth - width) / 2;
    } else {
      height = width / ratio;
      if (window.innerWidth < window.innerHeight) {
        // Portrait mobile
        top = 0;
      } else {
        top = (window.innerHeight - height) / 2;
      }
    }
    return { width, height, left, top };
  });

  const canPlay = computed(() => {
    return (
      model.value &&
      model.value.permission &&
      model.value.permission !== "audience" &&
      !replay.value.isReplaying &&
      !masquerading.value &&
      !replay.value.isReplaying
    );
  });

  const players = computed(() => sessions.value.filter((s) => s.isPlayer));

  const audiences = computed(() => sessions.value.filter((s) => !s.isPlayer));

  const unreadPrivateMessageCount = computed(
    () => chat.value.privateMessages.filter((m) => m.at > lastSeenPrivateMessage.value).length,
  );

  const whiteboard = computed(() => board.value.whiteboard);

  const jitsiTracks = computed(() => board.value.tracks);

  const reloadStreams = computed(() => _reloadStreams.value);

  const activeObject = computed(() =>
    board.value.objects.find((o) => o.id == _activeMovable.value),
  );

  const enabledLiveStreaming = computed(() => _enabledLiveStreaming.value);

  // ====================================================================
  // RETURN — public store surface
  //
  // Wave B will append mutation functions to this object. Wave C will
  // append action functions. Wave D will start migrating consumers to
  // this surface; Wave E will retire the Vuex stage module.
  // ====================================================================

  return {
    // state (raw refs, named to match Vuex `state.stage.*` paths)
    preloading,
    model,
    background,
    curtain,
    backdropColor,
    chatPosition,
    status,
    subscribeSuccess,
    _activeMovable,
    chat,
    board,
    tools,
    _config,
    settings,
    settingPopup,
    preferences,
    reactions,
    viewport,
    sessions,
    session,
    replay,
    audioPlayers,
    isSavingScene,
    isLoadingScenes,
    showPlayerChat,
    showClearChatSetting,
    showDownloadChatSetting,
    lastSeenPrivateMessage,
    masquerading,
    purchasePopup,
    receiptPopup,
    _reloadStreams,
    _enabledLiveStreaming,
    // getters (computed views, named to match Vuex `getters['stage/...']`)
    ready,
    url,
    objects,
    config,
    preloadableAssets,
    audios,
    currentAvatar,
    activeMovable,
    stageSize,
    canPlay,
    players,
    audiences,
    unreadPrivateMessageCount,
    whiteboard,
    jitsiTracks,
    reloadStreams,
    activeObject,
    enabledLiveStreaming,
  };
});
