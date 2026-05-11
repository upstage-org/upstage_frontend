// @ts-nocheck
/**
 * Pinia `stage` store — Phase 5.3 migration target.
 *
 * Mirrors the public surface of `src/store/modules/stage/index.ts` (the
 * still-authoritative Vuex stage module). State, getters, mutations,
 * and actions are all ported here (Waves A/B/C). Wave D will migrate
 * consumers off the Vuex module; Wave E will retire it. See
 * `REMAINING_STEPS.md` §3 for the full wave plan.
 *
 * Through Wave C the store is exported from `pinia/index.ts` and
 * exposed under `__UPSTAGE_PINIA__.stage` (dev/e2e only) so probes can
 * inspect it, but nothing in app code reads from it yet. The Pinia
 * `connect()` action is never called by any consumer during the Wave
 * C/D transition, so the wrapper's underlying MQTT client stays in
 * its initial unconnected state and there is no duplicate broker
 * traffic with the Vuex store.
 *
 * **Name collisions** (Vuex allowed `state.x`, `getters.x`, and
 * `actions.x` to coexist via separate namespaces; Pinia setup stores
 * cannot — a single return object exposes everything).
 *
 * State ↔ getter collisions (raw ref renamed with `_` prefix, public
 * computed keeps the Vuex getter name):
 *   • Vuex `state.activeMovable`    → Pinia `_activeMovable` (ref)
 *     Vuex `getters.activeMovable`  → Pinia `activeMovable` (computed)
 *   • Vuex `state.config`           → Pinia `_config` (ref)
 *     Vuex `getters.config`         → Pinia `config` (computed)
 *   • Vuex `state.reloadStreams`    → Pinia `_reloadStreams` (ref)
 *     Vuex `getters.reloadStreams`  → Pinia `reloadStreams` (computed)
 *   • Vuex `state.enabledLiveStreaming`   → Pinia `_enabledLiveStreaming`
 *     Vuex `getters.enabledLiveStreaming` → Pinia `enabledLiveStreaming`
 *
 * State/getter ↔ action collisions (action renamed; state/getter
 * keeps the Vuex name so reading consumers don't have to migrate):
 *   • Vuex `state.showPlayerChat` (ref) + action `showPlayerChat(visible)`
 *     → Pinia ref stays `showPlayerChat`; action becomes
 *     `setShowPlayerChat(visible)`. Wave D consumers calling
 *     `dispatch("stage/showPlayerChat", v)` switch to
 *     `useStageStore().setShowPlayerChat(v)`. Three call sites:
 *     PlayerChat.vue, PlayerChatTool.vue, Session.vue.
 *   • Vuex `getters.reloadStreams` (computed) + action `reloadStreams()`
 *     → Pinia computed stays `reloadStreams`; action becomes
 *     `triggerReloadStreams()`. Wave D: ReloadStream.vue switches
 *     `dispatch("stage/reloadStreams")` to
 *     `useStageStore().triggerReloadStreams()`.
 *
 * All other state keys, getter names, and action names keep their
 * Vuex names verbatim.
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { v4 as uuidv4 } from "uuid";
import hash from "object-hash";
import { animate } from "animejs";
import dayjs from "@utils/dayjs";
import buildClient from "@services/mqtt";
import { stageGraph } from "@services/graphql";
import {
  absolutePath,
  cloneDeep,
  randomColor,
  randomMessageColor,
  randomRange,
} from "@utils/common";
import { BACKGROUND_ACTIONS, BOARD_ACTIONS, COLORS, DRAW_ACTIONS, TOPICS } from "@utils/constants";
import {
  deserializeObject,
  getDefaultStageConfig,
  getDefaultStageSettings,
  recalcFontSize,
  serializeObject,
  unnamespaceTopic,
} from "@stores/modules/stage/reusable";
import { useAttribute } from "@services/graphql/composable";
import { avatarSpeak, stopSpeaking } from "@services/speech";
import { useAuthStore } from "@stores/pinia/auth";
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
  // MUTATIONS (Wave B) — 1:1 port of the Vuex `mutations` object (L229-678).
  //
  // In Pinia setup stores there is no notion of `commit`. Mutations are
  // plain functions that mutate the refs above. Names mirror the Vuex
  // UPPER_SNAKE_CASE contract so Wave C actions and Wave D consumers can
  // call them directly with no rename. The functions are intentionally
  // not exported individually; they go on the store via the return
  // object at the bottom of this file.
  // ====================================================================

  function SET_MODEL(newModel) {
    model.value = newModel;
    if (newModel) {
      const media = newModel.assets;
      if (media && media.length) {
        media.forEach((item) => {
          if (item.assetType?.name === "video") {
            item.url = absolutePath(item.fileLocation);
          } else {
            if (item.description) {
              const meta = JSON.parse(item.description);
              delete item.description;
              Object.assign(item, meta);
            }
            item.src = absolutePath(item.fileLocation);
          }
          if (item.multi) {
            item.frames = item.frames.map((src) => absolutePath(src));
          }
          const key = item.assetType?.name + "s";
          if (!tools.value[key]) {
            tools.value[key] = [];
          }
          tools.value[key].push(item);
        });
      } else {
        preloading.value = false;
      }
      const cfg = useAttribute({ value: newModel }, "config", true).value;
      if (cfg) {
        Object.assign(_config.value, cfg);
        _config.value.ratio = cfg.ratio.width / cfg.ratio.height;
        _enabledLiveStreaming.value =
          typeof cfg?.enabledLiveStreaming === "boolean" ? cfg?.enabledLiveStreaming : true;
      }
      // Match Stage Management default (#30AC45): new stages often have no
      // saved config yet, so do not leave backdropColor on CLEAN_STAGE's "gray".
      backdropColor.value = cfg?.defaultcolor || COLORS.DEFAULT_BACKDROP;
      const cover = useAttribute({ value: newModel }, "cover", false).value;
      model.value.cover = cover && absolutePath(cover);
    }
  }

  function CLEAN_STAGE(cleanModel) {
    if (cleanModel) {
      model.value = null;
      tools.value.audios = [];
    }
    status.value = "OFFLINE";
    replay.value.isReplaying = false;
    background.value = null;
    curtain.value = null;
    backdropColor.value = "gray";
    tools.value.avatars = [];
    tools.value.props = [];
    tools.value.backdrops = [];
    tools.value.streams = [];
    tools.value.curtains = [];
    _config.value = getDefaultStageConfig();
    settings.value = getDefaultStageSettings();
    board.value.objects = [];
    board.value.drawings = [];
    board.value.texts = [];
    board.value.whiteboard = [];
    chat.value.messages = [];
    chat.value.privateMessages = [];
    chat.value.color = randomColor();
  }

  function SET_BACKGROUND(bg) {
    if (bg) {
      if (!background.value || !background.value.at || background.value.at < bg.at) {
        if (!background.value || background.value.id !== bg.id) {
          // Not playing animation if only opacity change
          animate("#board", { opacity: [0, 1], duration: 5000 });
        }
        background.value = bg;
      }
    }
  }

  function SET_STATUS(newStatus) {
    status.value = newStatus;
  }

  function SET_SUBSCRIBE_STATUS(s) {
    subscribeSuccess.value = s;
  }

  function PUSH_CHAT_MESSAGE(message) {
    message.hash = hash(message);
    const lastMessage = chat.value.messages[chat.value.messages.length - 1];
    if (lastMessage && lastMessage.hash === message.hash) {
      return;
    }
    chat.value.messages.push(message);
  }

  function PUSH_PLAYER_CHAT_MESSAGE(message) {
    message.hash = hash(message);
    const lastMessage = chat.value.privateMessages[chat.value.privateMessages.length - 1];
    if (lastMessage && lastMessage.hash === message.hash) {
      return;
    }
    chat.value.privateMessages.push(message);
  }

  function CLEAR_CHAT() {
    chat.value.messages.length = 0;
  }

  function CLEAR_PLAYER_CHAT() {
    chat.value.privateMessages.length = 0;
  }

  function REMOVE_MESSAGE(id) {
    chat.value.messages = chat.value.messages.filter((m) => m.id !== id);
  }

  function HIGHLIGHT_MESSAGE(id) {
    const message = chat.value.messages.find((m) => m.id === id);
    if (message) {
      message.highlighted = !message.highlighted;
    }
  }

  function PUSH_OBJECT(object) {
    const { id } = object;
    deserializeObject(object);
    const m = board.value.objects.find((o) => o.id === id);
    if (m) {
      Object.assign(m, object);
    } else {
      board.value.objects.push(object);
    }
  }

  function UPDATE_OBJECT(object) {
    const { id } = object;
    deserializeObject(object);
    const m = board.value.objects.find((o) => o.id === id);
    if (m) {
      const deltaX = object.x - m.x;
      const deltaY = object.y - m.y;
      const deltaW = object.w / m.w;
      const deltaH = object.h / m.h;
      const deltaRotate = object.rotate - m.rotate;
      const costumes = board.value.objects.filter((o) => o.wornBy === id);
      if (costumes.length) {
        costumes.forEach((costume) => {
          costume.moveSpeed = object.moveSpeed;
          costume.opacity = object.opacity;
          costume.liveAction = object.liveAction;
          const offsetX = costume.x - m.x;
          const offsetY = costume.y - m.y;
          costume.x += deltaX + offsetX * deltaW - offsetX;
          costume.y += deltaY + offsetY * deltaH - offsetY;
          costume.w *= deltaW;
          costume.h *= deltaH;
          costume.rotate += deltaRotate;
        });
      }
      Object.assign(m, object);
    }
  }

  function DELETE_OBJECT(object) {
    const { id } = object;
    board.value.objects = board.value.objects.filter((o) => o.id !== id);
    board.value.objects
      .filter((o) => o.wornBy === id)
      .forEach((costume) => {
        costume.wornBy = null;
      });
  }

  function SET_OBJECT_SPEAK({ avatar, speak, mute }) {
    const { id } = avatar;
    const m = board.value.objects.find((o) => o.id === id);
    if (m) {
      speak.hash = hash(speak);
      if (m.speak?.hash !== speak.hash) {
        m.speak = speak;
        if (!mute && (status.value === "LIVE" || replay.value.isReplaying)) {
          avatarSpeak(m, speak.message);
        }
        setTimeout(
          () => {
            if (m.speak?.message === speak.message) {
              m.speak = null;
            }
          },
          1000 + speak.message.split(" ").length * 1000,
        );
      }
    }
  }

  function SET_PRELOADING_STATUS(s) {
    preloading.value = s;
  }

  function UPDATE_AUDIO(audio) {
    const m = tools.value.audios.find((a) => a.src === audio.src);
    if (m) {
      audio.changed = true;
      Object.assign(m, audio);
    }
  }

  function SET_SETTING_POPUP(setting) {
    settingPopup.value = setting;
  }

  function SEND_TO_BACK(object) {
    const index = board.value.objects.findIndex((avatar) => avatar.id === object.id);
    if (index > -1) {
      board.value.objects.unshift(board.value.objects.splice(index, 1)[0]);
    }
  }

  function BRING_TO_FRONT(object) {
    const index = board.value.objects.findIndex((avatar) => avatar.id === object.id);
    if (index > -1) {
      board.value.objects.push(board.value.objects.splice(index, 1)[0]);
    }
  }

  function BRING_TO_FRONT_OF({ front, back }) {
    const frontIndex = board.value.objects.findIndex((avatar) => avatar.id === front);
    const backIndex = board.value.objects.findIndex((avatar) => avatar.id === back);
    if (frontIndex > -1 && backIndex > -1) {
      board.value.objects.splice(backIndex, 0, board.value.objects.splice(frontIndex, 1)[0]);
    }
  }

  function SET_PREFERENCES(prefs) {
    Object.assign(preferences.value, prefs);
  }

  function PUSH_DRAWING(drawing) {
    board.value.drawings.push(cloneDeep(drawing));
  }

  function POP_DRAWING(drawingId) {
    board.value.drawings = board.value.drawings.filter((d) => d.drawingId !== drawingId);
  }

  function PUSH_TEXT(text) {
    board.value.texts.push(text);
  }

  function POP_TEXT(textId) {
    board.value.texts = board.value.texts.filter((d) => d.textId !== textId);
  }

  function UPDATE_IS_DRAWING(isDrawing) {
    preferences.value.isDrawing = isDrawing;
  }

  function UPDATE_IS_WRITING(isWriting) {
    preferences.value.isWriting = isWriting;
  }

  function UPDATE_TEXT_OPTIONS(options) {
    Object.assign(preferences.value.text, options);
  }

  function PUSH_REACTION(reaction) {
    reactions.value.push({
      reaction,
      x: randomRange(150, window.innerWidth) - 300,
      y: window.innerHeight - 100,
    });
    setTimeout(() => {
      reactions.value.shift();
    }, _config.value.reactionDuration);
  }

  function UPDATE_VIEWPORT(v) {
    viewport.value = v;
  }

  function RESCALE_OBJECTS(ratio) {
    board.value.objects.forEach((object) => {
      object.x = object.x * ratio;
      object.y = object.y * ratio;
      object.w = object.w * ratio;
      object.h = object.h * ratio;
      recalcFontSize(object, (s) => s * ratio);
    });
  }

  function SET_CHAT_PARAMETERS({ opacity, fontSize }) {
    chat.value.opacity = opacity;
    chat.value.fontSize = fontSize;
  }

  function SET_PLAYER_CHAT_PARAMETERS({ playerFontSize }) {
    chat.value.playerFontSize = playerFontSize;
  }

  function UPDATE_SESSIONS_COUNTER(s) {
    const index = sessions.value.findIndex((x) => x.id === s.id);
    if (index > -1) {
      if (s.leaving) {
        return sessions.value.splice(index, 1);
      } else {
        Object.assign(sessions.value[index], s);
      }
    } else {
      sessions.value.push(s);
    }
    sessions.value = sessions.value.filter(
      (x) => dayjs().diff(dayjs(new Date(x.at)), "minute") < 60,
    );
    sessions.value.sort((a, b) => b.at - a.at);
  }

  function SET_CHAT_VISIBILITY(visible) {
    settings.value.chatVisibility = visible;
  }

  function SET_DARK_MODE_CHAT(enabled) {
    settings.value.chatDarkMode = enabled;
  }

  function SET_REACTION_VISIBILITY(visible) {
    settings.value.reactionVisibility = visible;
  }

  function SET_CHAT_POSITION(position) {
    chatPosition.value = position;
  }

  function SET_BACKDROP_COLOR(color) {
    backdropColor.value = color;
  }

  function SET_REPLAY(r) {
    Object.assign(replay.value, r);
  }

  function SET_ACTIVE_MOVABLE(id) {
    _activeMovable.value = id;
  }

  function UPDATE_AUDIO_PLAYER_STATUS({ index, ...statusUpdate }) {
    if (!audioPlayers.value[index]) {
      audioPlayers.value[index] = {};
    }
    Object.assign(audioPlayers.value[index], statusUpdate);
  }

  function SET_CURTAIN(c) {
    curtain.value = c;
  }

  /**
   * Restore stage state from a saved-scene snapshot produced by
   * `takeSnapshotFromStage` (see reusable.ts). The snapshot carries
   * keys: background, backdropColor, board, settings, audioPlayers, audios.
   *
   * The Vuex original used `state[key] = snapshot[key]` in a dynamic
   * loop, which also created a never-read top-level `state.audios`.
   * Pinia setup stores can't add refs at runtime, so we restore each
   * known key explicitly. The snapshot's `audios` maps to
   * `tools.audios` (the only place that field is read).
   */
  function REPLACE_SCENE({ payload }) {
    animate("#live-stage", {
      filter: ["brightness(0)", "brightness(1)"],
      ease: "linear",
      duration: 3000,
    });
    _activeMovable.value = null;
    if (payload) {
      const snapshot = JSON.parse(payload);
      snapshot.board.objects.forEach(deserializeObject);
      snapshot.board.tracks = board.value.tracks;
      if (snapshot.background !== undefined) background.value = snapshot.background;
      if (snapshot.backdropColor !== undefined) backdropColor.value = snapshot.backdropColor;
      if (snapshot.board !== undefined) board.value = snapshot.board;
      if (snapshot.settings !== undefined) settings.value = snapshot.settings;
      if (snapshot.audioPlayers !== undefined) {
        if (snapshot.audioPlayers.length === 0 && audioPlayers.value.length > 0) {
          audioPlayers.value.forEach((p) => {
            p.currentTime = 0;
          });
        } else {
          audioPlayers.value = snapshot.audioPlayers;
        }
      }
      if (snapshot.audios !== undefined) {
        tools.value.audios = snapshot.audios;
      }
    }
  }

  function SET_SAVING_SCENE(v) {
    isSavingScene.value = v;
  }

  function SET_SHOW_PLAYER_CHAT(v) {
    showPlayerChat.value = v;
  }

  function SET_SHOW_CLEAR_CHAT_SETTINGS(v) {
    showClearChatSetting.value = v;
  }

  function SET_SHOW_DOWNLOAD_CHAT_SETTINGS(v) {
    showDownloadChatSetting.value = v;
  }

  function TAG_PLAYER(player) {
    chat.value.privateMessage += `@${player.nickname.trim()}`;
  }

  function SEEN_PRIVATE_MESSAGES() {
    const length = chat.value.privateMessages.length;
    if (length > 0) {
      lastSeenPrivateMessage.value = chat.value.privateMessages[length - 1].at;
      localStorage.setItem("lastSeenPrivateMessage", lastSeenPrivateMessage.value);
    }
  }

  function UPDATE_WHITEBOARD(message) {
    if (!board.value.whiteboard) {
      board.value.whiteboard = [];
    }
    switch (message.type) {
      case DRAW_ACTIONS.NEW_LINE:
        board.value.whiteboard = board.value.whiteboard.concat(message.command);
        break;
      case DRAW_ACTIONS.UNDO:
        board.value.whiteboard = board.value.whiteboard.filter((e, i) => i !== message.index);
        break;
      case DRAW_ACTIONS.CLEAR:
        board.value.whiteboard = [];
        break;
      default:
        break;
    }
  }

  function TOGGLE_MASQUERADING() {
    masquerading.value = !masquerading.value;
  }

  function CREATE_ROOM(room) {
    tools.value.meetings.push(room);
  }

  function CREATE_STREAM(room) {
    tools.value.streams.push(room);
  }

  function REORDER_TOOLBOX({ from, to }) {
    console.log(from, to);
    if (from.scenePreview) {
      // is scene
      const fromIndex = model.value.scenes.findIndex((t) => t.id === from.id);
      const toIndex = model.value.scenes.findIndex((t) => t.id === to.id);
      if (fromIndex > -1 && toIndex > -1) {
        const tool = model.value.scenes.splice(fromIndex, 1)[0];
        model.value.scenes.splice(toIndex, 0, tool);
      }
    } else if (from.drawingId) {
      // is drawing
      const fromIndex = board.value.drawings.findIndex((t) => t.drawingId === from.drawingId);
      const toIndex = board.value.drawings.findIndex((t) => t.drawingId === to.drawingId);
      if (fromIndex > -1 && toIndex > -1) {
        const tool = board.value.drawings.splice(fromIndex, 1)[0];
        board.value.drawings.splice(toIndex, 0, tool);
      }
    } else if (from.textId) {
      // is text
      const fromIndex = board.value.texts.findIndex((t) => t.textId === from.textId);
      const toIndex = board.value.texts.findIndex((t) => t.textId === to.textId);
      if (fromIndex > -1 && toIndex > -1) {
        const tool = board.value.texts.splice(fromIndex, 1)[0];
        board.value.texts.splice(toIndex, 0, tool);
      }
    } else {
      const toolName = from.type + "s";
      if (tools.value[toolName]) {
        const fromIndex = tools.value[toolName].findIndex((t) => t.id === from.id);
        const toIndex = tools.value[toolName].findIndex((t) => t.id === to.id);
        if (fromIndex > -1 && toIndex > -1) {
          const tool = tools.value[toolName].splice(fromIndex, 1)[0];
          tools.value[toolName].splice(toIndex, 0, tool);
        }
      }
    }
  }

  function SET_PURCHASE_POPUP(purchase) {
    purchasePopup.value = purchase;
    if (purchase.isActive) {
      receiptPopup.value.donationDetails = {
        ...purchase,
        date: new Date().toLocaleDateString(),
      };
    }
  }

  function ADD_TRACK(track) {
    board.value.tracks = [...board.value.tracks, track];
  }

  function RELOAD_STREAMS() {
    _reloadStreams.value = new Date();
  }

  function OPEN_RECEIPT_POPUP(_payload) {
    receiptPopup.value.isActive = true;
  }

  function CLOSE_RECEIPT_POPUP() {
    receiptPopup.value.isActive = false;
  }

  // ====================================================================
  // MQTT CLIENT WRAPPER
  //
  // `buildClient()` returns an unconnected wrapper. The underlying broker
  // connection only opens when the `connect()` action below is invoked.
  // Pinia setup functions run exactly once per store (the result is
  // memoized) so we get a single wrapper instance per app lifetime.
  //
  // During Wave D's gradual consumer migration both this wrapper and the
  // Vuex stage module's wrapper will exist. Only one should call
  // `mqtt.connect()` to avoid double subscriptions; the migration plan
  // (see REMAINING_STEPS.md §3 Wave D) addresses that.
  // ====================================================================
  const mqtt = buildClient();

  // ====================================================================
  // ACTIONS (Wave C) — 1:1 port of the Vuex `actions` object (L679-1460).
  //
  // Pinia setup stores have no commit/dispatch — actions just call
  // mutation functions and other action functions directly. Function
  // declarations are hoisted, so cross-references (e.g. `connect` calls
  // `subscribe` which is defined later) work without ordering pain.
  // ====================================================================

  function connect() {
    SET_STATUS("CONNECTING");
    const client = mqtt.connect();
    client.on("connect", () => {
      SET_STATUS("LIVE");
      void reloadMissingEvents();
      subscribe();
      void joinStage();
    });
    client.on("error", (err) => {
      console.error("[MQTT] Stage client error:", err?.message ?? err);
      SET_STATUS("OFFLINE");
    });
    client.on("reconnect", () => SET_STATUS("CONNECTING"));
    client.on("close", () => SET_STATUS("OFFLINE"));
    client.on("disconnect", () => SET_STATUS("OFFLINE"));
    client.on("offline", () => SET_STATUS("OFFLINE"));
    mqtt.receiveMessage((payload) => handleMessage(payload));
  }

  function subscribe() {
    const topics = {
      [TOPICS.CHAT]: { qos: 2 },
      [TOPICS.BOARD]: { qos: 2 },
      [TOPICS.BACKGROUND]: { qos: 2 },
      [TOPICS.AUDIO]: { qos: 2 },
      [TOPICS.REACTION]: { qos: 2 },
      [TOPICS.COUNTER]: { qos: 2 },
      [TOPICS.DRAW]: { qos: 2 },
    };
    mqtt
      .subscribe(topics)
      .then((res) => {
        SET_SUBSCRIBE_STATUS(true);
        console.log("Subscribed to topics: ", res);
      })
      .catch((error) => console.log(error));
  }

  async function disconnect() {
    await leaveStage();
    mqtt.disconnect();
  }

  function handleMessage({ topic, message }) {
    switch (topic) {
      case TOPICS.CHAT:
        handleChatMessage({ message });
        break;
      case TOPICS.BOARD:
        handleBoardMessage({ message });
        break;
      case TOPICS.BACKGROUND:
        handleBackgroundMessage({ message });
        break;
      case TOPICS.AUDIO:
        handleAudioMessage({ message });
        break;
      case TOPICS.REACTION:
        handleReactionMessage({ message });
        break;
      case TOPICS.COUNTER:
        handleCounterMessage({ message });
        break;
      case TOPICS.DRAW:
        handleDrawMessage({ message });
        break;
      default:
        break;
    }
  }

  function sendChat({ message, isPrivate }) {
    if (!message) return;
    let user = useUserStore().chatname;
    let isPlayer = canPlay.value;
    let behavior = "speak";
    const currentSession = session.value;
    if (message.startsWith(":")) {
      behavior = "think";
      message = message.substr(1);
    }
    if (message.startsWith("!")) {
      behavior = "shout";
      message = message.substr(1).toUpperCase();
    }
    if (isPlayer && message.startsWith("-")) {
      message = message.substr(1);
      const fakeName = message.split(" ")[0];
      if (fakeName) {
        user = fakeName;
        message = message.substr(fakeName.length).trim();
      }
      isPlayer = false;
    }
    const payload = {
      user,
      message: message,
      behavior,
      isPlayer,
      isPrivate,
      session: currentSession,
      at: +new Date(),
      id: uuidv4(),
    };
    mqtt.sendMessage(TOPICS.CHAT, payload);
    const avatar = currentAvatar.value;
    if (avatar && isPlayer && !isPrivate) {
      mqtt.sendMessage(TOPICS.BOARD, {
        type: BOARD_ACTIONS.SPEAK,
        avatar,
        speak: payload,
      });
    }
  }

  /**
   * Make the held avatar speak (bubble + TTS) WITHOUT writing to the
   * public chat log. Mirrors the SPEAK side of `sendChat` — same payload
   * shape, same topic — but skips `TOPICS.CHAT` entirely.
   */
  function speakAsAvatar({ message, behavior }) {
    if (!message) return;
    const avatar = currentAvatar.value;
    if (!avatar) return;
    const isPlayer = canPlay.value;
    if (!isPlayer) return;
    const finalBehavior = behavior === "shout" || behavior === "think" ? behavior : "speak";
    const finalMessage = finalBehavior === "shout" ? String(message).toUpperCase() : message;
    const speak = {
      user: useUserStore().chatname,
      message: finalMessage,
      behavior: finalBehavior,
      isPlayer: true,
      isPrivate: false,
      session: session.value,
      at: +new Date(),
      id: uuidv4(),
    };
    mqtt.sendMessage(TOPICS.BOARD, {
      type: BOARD_ACTIONS.SPEAK,
      avatar,
      speak,
    });
  }

  function handleChatMessage({ message }) {
    if (message.clear) {
      CLEAR_CHAT();
      return;
    }
    if (message.clearPlayerChat) {
      CLEAR_PLAYER_CHAT();
      return;
    }
    if (message.remove) {
      REMOVE_MESSAGE(message.remove);
      return;
    }
    if (message.highlight) {
      HIGHLIGHT_MESSAGE(message.highlight);
      return;
    }
    const m = {
      user: "Anonymous",
      color: "#000000",
    };
    if (typeof message === "object") {
      Object.assign(m, message);
    } else {
      m.message = message;
    }
    if (message.isPrivate) {
      PUSH_PLAYER_CHAT_MESSAGE(m);
      if (message.at > lastSeenPrivateMessage.value) {
        if (showPlayerChat.value) {
          SEEN_PRIVATE_MESSAGES();
        } else {
          const nickname = useUserStore().nickname ?? "";
          if (message.message.toLowerCase().includes(`@${nickname.trim().toLowerCase()}`)) {
            setShowPlayerChat(true);
          }
        }
      }
    } else {
      PUSH_CHAT_MESSAGE(m);
    }
  }

  function placeObjectOnStage(data) {
    const object = {
      w: 100,
      h: 100,
      opacity: 1,
      moveSpeed: 2000,
      voice: {},
      volume: 100,
      rotate: 0,
      ...data,
      id: uuidv4(),
      type: data.assetType?.name || data.type,
    };
    if (object.type === "video") {
      object.hostId = session.value;
      try {
        const description = JSON.parse(data.description);
        if (description.w && description.h) object.h = (description.h * 100) / description.w;
      } catch {
        // description is optional / may not be JSON; fall back to defaults.
      }
    }
    PUSH_OBJECT(serializeObject(object));
    if (object.type === "avatar") {
      useUserStore().setAvatarId(object.id);
      SET_ACTIVE_MOVABLE(null);
    }
    return object;
  }

  function shapeObject(object) {
    if (object.liveAction) {
      if (object.published) {
        mqtt.sendMessage(TOPICS.BOARD, {
          type: BOARD_ACTIONS.MOVE_TO,
          object: serializeObject(object),
        });
      } else {
        object.published = true;
        object.displayName = useUserStore().nickname ?? "";
        mqtt.sendMessage(TOPICS.BOARD, {
          type: BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE,
          object: serializeObject(object),
        });
      }
      board.value.objects
        .filter((o) => o.wornBy === object.id)
        .forEach((costume) => {
          if (!costume.published) {
            costume.published = true;
            mqtt.sendMessage(TOPICS.BOARD, {
              type: BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE,
              object: serializeObject(costume),
            });
          }
        });
    } else {
      UPDATE_OBJECT(serializeObject(object));
    }
  }

  function deleteObject(object) {
    object = serializeObject(object);
    if (object.drawingId) {
      // is drawing
      delete object.commands;
    }
    mqtt.sendMessage(TOPICS.BOARD, {
      type: BOARD_ACTIONS.DESTROY,
      object,
    });
  }

  function switchFrame(object) {
    mqtt.sendMessage(TOPICS.BOARD, {
      type: BOARD_ACTIONS.SWITCH_FRAME,
      object: serializeObject(object),
    });
  }

  function sendToBack(object) {
    mqtt.sendMessage(TOPICS.BOARD, {
      type: BOARD_ACTIONS.SEND_TO_BACK,
      object: serializeObject(object),
    });
  }

  function bringToFront(object) {
    mqtt.sendMessage(TOPICS.BOARD, {
      type: BOARD_ACTIONS.BRING_TO_FRONT,
      object: serializeObject(object),
    });
  }

  function bringToFrontOf({ front, back }) {
    mqtt.sendMessage(TOPICS.BOARD, {
      type: BOARD_ACTIONS.BRING_TO_FRONT_OF,
      front,
      back,
    });
  }

  function toggleAutoplayFrames(object) {
    mqtt.sendMessage(TOPICS.BOARD, {
      type: BOARD_ACTIONS.TOGGLE_AUTOPLAY_FRAMES,
      object: serializeObject(object),
    });
  }

  function handleBoardMessage({ message }) {
    switch (message.type) {
      case BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE:
        PUSH_OBJECT(message.object);
        break;
      case BOARD_ACTIONS.MOVE_TO:
        UPDATE_OBJECT(message.object);
        break;
      case BOARD_ACTIONS.DESTROY:
        DELETE_OBJECT(message.object);
        break;
      case BOARD_ACTIONS.SWITCH_FRAME:
        UPDATE_OBJECT(message.object);
        break;
      case BOARD_ACTIONS.SPEAK:
        SET_OBJECT_SPEAK(message);
        break;
      case BOARD_ACTIONS.SEND_TO_BACK:
        SEND_TO_BACK(message.object);
        break;
      case BOARD_ACTIONS.BRING_TO_FRONT:
        BRING_TO_FRONT(message.object);
        break;
      case BOARD_ACTIONS.BRING_TO_FRONT_OF:
        BRING_TO_FRONT_OF(message);
        break;
      case BOARD_ACTIONS.TOGGLE_AUTOPLAY_FRAMES:
        UPDATE_OBJECT(message.object);
        break;
      default:
        break;
    }
  }

  function setBackground(bg) {
    bg.at = +new Date();
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.CHANGE_BACKGROUND,
      background: bg,
    });
  }

  function showChatBox(visible) {
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.SET_CHAT_VISIBILITY,
      visible,
    });
  }

  function enableDarkModeChat(enabled) {
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.SET_DARK_MODE_CHAT,
      enabled,
    });
  }

  function showReactionsBar(visible) {
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.SET_REACTION_VISIBILITY,
      visible,
    });
  }

  function setChatPosition(position) {
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.SET_CHAT_POSITION,
      position,
    });
  }

  function setBackdropColor(color) {
    console.log("SET_BACKDROP_COLOR", color);
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.SET_BACKDROP_COLOR,
      color,
    });
  }

  function drawCurtain(c) {
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.DRAW_CURTAIN,
      curtain: c,
    });
  }

  function loadScenes() {
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.LOAD_SCENES,
    });
  }

  function switchScene(scene) {
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.SWITCH_SCENE,
      scene,
    });
  }

  function blankScene() {
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.BLANK_SCENE,
    });
  }

  function handleBackgroundMessage({ message }) {
    switch (message.type) {
      case BACKGROUND_ACTIONS.CHANGE_BACKGROUND:
        SET_BACKGROUND(message.background);
        break;
      case BACKGROUND_ACTIONS.SET_CHAT_VISIBILITY:
        SET_CHAT_VISIBILITY(message.visible);
        break;
      case BACKGROUND_ACTIONS.SET_DARK_MODE_CHAT:
        SET_DARK_MODE_CHAT(message.enabled);
        break;
      case BACKGROUND_ACTIONS.SET_REACTION_VISIBILITY:
        SET_REACTION_VISIBILITY(message.visible);
        break;
      case BACKGROUND_ACTIONS.SET_CHAT_POSITION:
        SET_CHAT_POSITION(message.position);
        break;
      case BACKGROUND_ACTIONS.SET_BACKDROP_COLOR:
        SET_BACKDROP_COLOR(message.color);
        break;
      case BACKGROUND_ACTIONS.DRAW_CURTAIN:
        SET_CURTAIN(message.curtain);
        break;
      case BACKGROUND_ACTIONS.LOAD_SCENES:
        void reloadScenes();
        break;
      case BACKGROUND_ACTIONS.SWITCH_SCENE:
        replaceScene(message.scene);
        break;
      case BACKGROUND_ACTIONS.BLANK_SCENE: {
        const blankBackdrop =
          _config.value?.defaultcolor || backdropColor.value || COLORS.DEFAULT_BACKDROP;
        REPLACE_SCENE({
          payload: JSON.stringify({
            background: null,
            backdropColor: blankBackdrop,
            board: {
              objects: [],
              drawings: [],
              texts: [],
              tracks: [],
            },
            audioPlayers: [],
          }),
        });
        break;
      }
      default:
        break;
    }
  }

  function updateAudioStatus(audio) {
    mqtt.sendMessage(TOPICS.AUDIO, audio);
  }

  function handleAudioMessage({ message }) {
    UPDATE_AUDIO(message);
  }

  function closeSettingPopup() {
    SET_SETTING_POPUP({ isActive: false });
  }

  function openSettingPopup(setting) {
    setting.isActive = true;
    SET_SETTING_POPUP(setting);
  }

  function addDrawing(drawing) {
    PUSH_DRAWING(drawing);
    placeObjectOnStage(drawing);
  }

  function addText(text) {
    text.type = "text";
    PUSH_TEXT(text);
    placeObjectOnStage(text);
  }

  function handleReactionMessage({ message }) {
    PUSH_REACTION(message);
  }

  function sendReaction(reaction) {
    mqtt.sendMessage(TOPICS.REACTION, reaction);
  }

  async function loadStage({ url, recordId }) {
    CLEAN_STAGE(true);
    SET_PRELOADING_STATUS(true);
    try {
      const { stage } = await stageGraph.loadStage(url, recordId);
      if (stage) {
        SET_MODEL(stage);
        const { events } = stage;
        if (recordId && events) {
          SET_REPLAY({
            timestamp: {
              begin: events[0].mqttTimestamp,
              current: events[0].mqttTimestamp,
              end: events[events.length - 1].mqttTimestamp,
            },
          });
        } else {
          (events || []).forEach((event) => replayEvent(event));
        }
        await stageGraph.updateLastAccess(stage.id);
      } else {
        SET_PRELOADING_STATUS(false);
      }
    } catch (e) {
      console.error("[stage/loadStage] failed", e);
      SET_PRELOADING_STATUS(false);
    }
  }

  async function reloadPermission() {
    const { stage } = await stageGraph.loadStage(model.value.fileLocation);
    if (stage) {
      model.value.permission = stage.permission;
    }
  }

  async function loadPermission() {
    const permission = model.value.permission;
    if (permission == "owner" || permission == "editor" || permission == "player") {
      SET_SHOW_CLEAR_CHAT_SETTINGS(true);
      SET_SHOW_DOWNLOAD_CHAT_SETTINGS(true);
    } else {
      SET_SHOW_CLEAR_CHAT_SETTINGS(false);
      SET_SHOW_DOWNLOAD_CHAT_SETTINGS(false);
    }
  }

  async function reloadScenes() {
    isLoadingScenes.value = true;
    const scenes = await stageGraph.loadScenes(model.value.fileLocation);
    if (scenes) {
      model.value.scenes = scenes;
    }
    isLoadingScenes.value = false;
  }

  async function reloadMissingEvents() {
    if (model.value.events) {
      const lastEventId = model.value.events[model.value.events.length - 1]?.id ?? 0;
      const events = await stageGraph.loadEvents(model.value.fileLocation, lastEventId);
      if (events) {
        events.forEach((event) => replicateEvent(event));
        model.value.events = model.value.events.concat(events);
      }
    }
  }

  function replaceScene(sceneId) {
    animate("#live-stage", {
      filter: "brightness(0)",
    });
    const scene = model.value.scenes.find((s) => s.id == sceneId);
    if (scene) {
      REPLACE_SCENE(scene);
    } else {
      if (isLoadingScenes.value) {
        setTimeout(() => replaceScene(sceneId), 1000); // retry after scenes load
      } else {
        REPLACE_SCENE({ payload: null });
      }
    }
  }

  /**
   * Deep-clone the event payload before dispatching. The payload sitting
   * in `state.model.events[i].payload` is a SHARED reference that
   * survives the entire replay session. Downstream mutations (notably
   * `deserializeObject`, called by PUSH_OBJECT and UPDATE_OBJECT)
   * rewrite x/y/w/h IN PLACE — converting `relative → absolute` on
   * first replay, then `absolute → multiplied-absolute` on every
   * subsequent replay/seek. After two passes the avatar lands far
   * off-screen and the stage looks blank even though the replay timer
   * keeps ticking. Cloning here scopes that mutation to one playback only.
   */
  function replayEvent({ topic, payload }) {
    const clone = JSON.parse(JSON.stringify(payload));
    handleMessage({
      topic: unnamespaceTopic(topic),
      message: clone,
    });
  }

  function replicateEvent({ topic, payload }) {
    // Same shared-reference hazard as `replayEvent` — see comment there.
    const message = JSON.parse(JSON.stringify(payload));
    message.mute = true;
    handleMessage({
      topic: unnamespaceTopic(topic),
      message,
    });
  }

  async function replayRecording(timestamp) {
    stopSpeaking();
    pauseReplay();
    const current = timestamp ? Number(timestamp) : replay.value.timestamp.begin;
    replay.value.timestamp.current = current;
    // Preserve persistent stage-config values across CLEAN_STAGE. Backdrop
    // color and config live on stage attributes (not in the MQTT event
    // stream), so CLEAN_STAGE wiping them produces a visible flash that
    // doesn't correspond to anything in the original performance.
    const preservedBackdropColor = backdropColor.value;
    const preservedConfig = _config.value;
    CLEAN_STAGE();
    backdropColor.value = preservedBackdropColor;
    _config.value = preservedConfig;
    replay.value.isReplaying = true;
    const events = model.value.events;
    const speed = replay.value.speed;
    replay.value.interval = setInterval(() => {
      replay.value.timestamp.current += 1;
      if (replay.value.timestamp.current > replay.value.timestamp.end) {
        replay.value.timestamp.current = replay.value.timestamp.begin;
        pauseReplay();
      }
    }, 1000 / speed);
    events.forEach((event) => {
      if (event.mqttTimestamp - current >= 0) {
        const timer = setTimeout(
          () => {
            replayEvent(event);
          },
          ((event.mqttTimestamp - current) * 1000) / speed,
        );
        replay.value.timers.push(timer);
      } else {
        replicateEvent(event);
      }
    });
  }

  function pauseReplay() {
    clearInterval(replay.value.interval);
    replay.value.interval = null;
    replay.value.timers.forEach((timer) => clearTimeout(timer));
    replay.value.timers = [];
    tools.value.audios.forEach((audio) => {
      audio.isPlaying = false;
      audio.changed = true;
    });
  }

  function seekForwardReplay() {
    const current = replay.value.timestamp.current + 10000;
    const nextEvent = model.value.events.find((e) => e.mqttTimestamp > current);
    if (nextEvent) {
      void replayRecording(nextEvent.mqttTimestamp);
    }
  }

  function seekBackwardReplay() {
    const current = replay.value.timestamp.current - 10000;
    let event = null;
    for (let i = model.value.events.length - 1; i >= 0; i--) {
      event = model.value.events[i];
      if (event.mqttTimestamp < current) {
        break;
      }
    }
    if (event) {
      void replayRecording(event.mqttTimestamp);
    }
  }

  function handleCounterMessage({ message }) {
    UPDATE_SESSIONS_COUNTER(message);
    if (message.id === session.value && message.avatarId) {
      useUserStore().avatarId = message.avatarId;
    }
  }

  async function joinStage() {
    const userStore = useUserStore();
    if (!session.value) {
      session.value = userStore.user?.id ?? uuidv4();
    }
    const id = session.value;
    const isPlayer = useAuthStore().loggedIn;
    const nickname = userStore.nickname;
    const avatarId = userStore.avatarId;
    SET_ACTIVE_MOVABLE(avatarId);
    const at = +new Date();
    const payload = { id, isPlayer, nickname, at, avatarId };
    await mqtt.sendMessage(TOPICS.COUNTER, payload);
    await sendStatistics();
  }

  async function leaveStage() {
    await Promise.all([sendStatisticsBeforeDisconnect(), sendCounterLeave()]);
  }

  async function sendStatisticsBeforeDisconnect() {
    const isPlayer = useAuthStore().loggedIn;
    let playerCount = players.value.length;
    let audienceCount = audiences.value.length;
    if (isPlayer) {
      playerCount = playerCount - 1;
    } else {
      audienceCount = audienceCount - 1;
    }
    await mqtt.sendMessage(
      TOPICS.STATISTICS,
      { players: playerCount, audiences: audienceCount },
      false,
      true,
    );
  }

  async function sendCounterLeave() {
    const id = session.value;
    session.value = null;
    CLEAN_STAGE();
    await mqtt.sendMessage(TOPICS.COUNTER, { id, leaving: true });
  }

  async function sendStatistics() {
    if (subscribeSuccess.value) {
      await mqtt.sendMessage(
        TOPICS.STATISTICS,
        {
          players: players.value.length,
          audiences: audiences.value.length,
        },
        false,
        true,
      );
    }
  }

  function clearChat() {
    mqtt.sendMessage(TOPICS.CHAT, { clear: true });
  }

  function clearPlayerChat() {
    mqtt.sendMessage(TOPICS.CHAT, { clearPlayerChat: true });
  }

  function removeChat(messageId) {
    mqtt.sendMessage(TOPICS.CHAT, { remove: messageId });
  }

  function highlightChat(messageId) {
    mqtt.sendMessage(TOPICS.CHAT, { highlight: messageId });
  }

  /**
   * Set the player-chat panel visibility. Renamed from Vuex's
   * `showPlayerChat(visible)` action because the state ref of the same
   * name already lives on the return object (Pinia setup stores can't
   * have two keys with the same name). See file-header note.
   */
  function setShowPlayerChat(visible) {
    SET_SHOW_PLAYER_CHAT(visible);
    if (visible) {
      SEEN_PRIVATE_MESSAGES();
    }
  }

  function autoFocusMoveable(id) {
    if (canPlay.value && !preferences.value.isDrawing && !replay.value.isReplaying) {
      SET_ACTIVE_MOVABLE(id);
    }
  }

  function handleDrawMessage({ message }) {
    UPDATE_WHITEBOARD(message);
  }

  function sendDrawWhiteboard(command) {
    mqtt.sendMessage(TOPICS.DRAW, { type: DRAW_ACTIONS.NEW_LINE, command });
  }

  function sendUndoWhiteboard() {
    mqtt.sendMessage(TOPICS.DRAW, {
      type: DRAW_ACTIONS.UNDO,
      index: board.value.whiteboard.length - 1,
    });
  }

  function sendClearWhiteboard() {
    mqtt.sendMessage(TOPICS.DRAW, { type: DRAW_ACTIONS.CLEAR });
  }

  function closePurchasePopup() {
    SET_PURCHASE_POPUP({ isActive: false });
  }

  function openPurchasePopup(setting) {
    setting.isActive = true;
    SET_PURCHASE_POPUP(setting);
  }

  function openReceiptPopup(setting) {
    OPEN_RECEIPT_POPUP(setting);
  }

  function closeReceiptPopup() {
    CLOSE_RECEIPT_POPUP();
  }

  function addTrack(track) {
    ADD_TRACK(track);
  }

  /**
   * Trigger a stream-reload tick. Renamed from Vuex's `reloadStreams()`
   * action because the getter `reloadStreams` lives on the return object
   * (Pinia setup stores can't have two keys with the same name). See
   * file-header note.
   */
  function triggerReloadStreams() {
    RELOAD_STREAMS();
  }

  // ====================================================================
  // RETURN — public store surface
  //
  // Wave D will start migrating consumers to this surface; Wave E will
  // retire the Vuex stage module entirely.
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
    // mutations (UPPER_SNAKE_CASE, named to match Vuex `commit('stage/X')`)
    SET_MODEL,
    CLEAN_STAGE,
    SET_BACKGROUND,
    SET_STATUS,
    SET_SUBSCRIBE_STATUS,
    PUSH_CHAT_MESSAGE,
    PUSH_PLAYER_CHAT_MESSAGE,
    CLEAR_CHAT,
    CLEAR_PLAYER_CHAT,
    REMOVE_MESSAGE,
    HIGHLIGHT_MESSAGE,
    PUSH_OBJECT,
    UPDATE_OBJECT,
    DELETE_OBJECT,
    SET_OBJECT_SPEAK,
    SET_PRELOADING_STATUS,
    UPDATE_AUDIO,
    SET_SETTING_POPUP,
    SEND_TO_BACK,
    BRING_TO_FRONT,
    BRING_TO_FRONT_OF,
    SET_PREFERENCES,
    PUSH_DRAWING,
    POP_DRAWING,
    PUSH_TEXT,
    POP_TEXT,
    UPDATE_IS_DRAWING,
    UPDATE_IS_WRITING,
    UPDATE_TEXT_OPTIONS,
    PUSH_REACTION,
    UPDATE_VIEWPORT,
    RESCALE_OBJECTS,
    SET_CHAT_PARAMETERS,
    SET_PLAYER_CHAT_PARAMETERS,
    UPDATE_SESSIONS_COUNTER,
    SET_CHAT_VISIBILITY,
    SET_DARK_MODE_CHAT,
    SET_REACTION_VISIBILITY,
    SET_CHAT_POSITION,
    SET_BACKDROP_COLOR,
    SET_REPLAY,
    SET_ACTIVE_MOVABLE,
    UPDATE_AUDIO_PLAYER_STATUS,
    SET_CURTAIN,
    REPLACE_SCENE,
    SET_SAVING_SCENE,
    SET_SHOW_PLAYER_CHAT,
    SET_SHOW_CLEAR_CHAT_SETTINGS,
    SET_SHOW_DOWNLOAD_CHAT_SETTINGS,
    TAG_PLAYER,
    SEEN_PRIVATE_MESSAGES,
    UPDATE_WHITEBOARD,
    TOGGLE_MASQUERADING,
    CREATE_ROOM,
    CREATE_STREAM,
    REORDER_TOOLBOX,
    SET_PURCHASE_POPUP,
    ADD_TRACK,
    RELOAD_STREAMS,
    OPEN_RECEIPT_POPUP,
    CLOSE_RECEIPT_POPUP,
    // actions (lowerCamelCase, named to match Vuex `dispatch('stage/X')`
    // except where a collision with a state ref or getter forced a rename
    // — see file-header note for `setShowPlayerChat` and
    // `triggerReloadStreams`).
    connect,
    subscribe,
    disconnect,
    handleMessage,
    sendChat,
    speakAsAvatar,
    handleChatMessage,
    placeObjectOnStage,
    shapeObject,
    deleteObject,
    switchFrame,
    sendToBack,
    bringToFront,
    bringToFrontOf,
    toggleAutoplayFrames,
    handleBoardMessage,
    setBackground,
    showChatBox,
    enableDarkModeChat,
    showReactionsBar,
    setChatPosition,
    setBackdropColor,
    drawCurtain,
    loadScenes,
    switchScene,
    blankScene,
    handleBackgroundMessage,
    updateAudioStatus,
    handleAudioMessage,
    closeSettingPopup,
    openSettingPopup,
    addDrawing,
    addText,
    handleReactionMessage,
    sendReaction,
    loadStage,
    reloadPermission,
    loadPermission,
    reloadScenes,
    reloadMissingEvents,
    replaceScene,
    replayEvent,
    replicateEvent,
    replayRecording,
    pauseReplay,
    seekForwardReplay,
    seekBackwardReplay,
    handleCounterMessage,
    joinStage,
    leaveStage,
    sendStatisticsBeforeDisconnect,
    sendCounterLeave,
    sendStatistics,
    clearChat,
    clearPlayerChat,
    removeChat,
    highlightChat,
    setShowPlayerChat,
    autoFocusMoveable,
    handleDrawMessage,
    sendDrawWhiteboard,
    sendUndoWhiteboard,
    sendClearWhiteboard,
    closePurchasePopup,
    openPurchasePopup,
    openReceiptPopup,
    closeReceiptPopup,
    addTrack,
    triggerReloadStreams,
  };
});
