/**
 * Pinia `stage` store — authoritative source of stage state,
 * mutations, and actions. Every consumer reads/writes through
 * `useStageStore()`; the dev hook `__UPSTAGE_PINIA__.stage` lets the
 * Playwright e2e suites drive the same surface from outside the app.
 *
 * **Name collisions.** Setup stores can't have two return-object keys
 * with the same name, so a handful of state/getter/action triples that
 * were free to share a name under the old store had to disambiguate:
 *
 * State ↔ getter collisions (raw ref carries a `_` prefix, public
 * computed keeps the original name so consumers don't have to migrate):
 *   • `_activeMovable` (ref) / `activeMovable` (computed)
 *   • `_config` (ref) / `config` (computed)
 *   • `_reloadStreams` (ref) / `reloadStreams` (computed)
 *   • `_enabledLiveStreaming` (ref) / `enabledLiveStreaming` (computed)
 *
 * State/getter ↔ action collisions (action renamed; the state/getter
 * keeps the original name):
 *   • `showPlayerChat` (ref) + `setShowPlayerChat(visible)` (action).
 *     Three call sites: PlayerChat.vue, PlayerChatTool.vue, Session.vue.
 *   • `reloadStreams` (computed) + `triggerReloadStreams()` (action).
 *     One call site: ReloadStream.vue.
 *
 * All other state keys, getter names, and action names map straight
 * across with no rename.
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
  serializeForBroadcast,
  serializeObject,
  unnamespaceTopic,
} from "@stores/modules/stage/reusable";
import { useAttribute } from "@services/graphql/composable";
import { avatarSpeak, stopSpeaking } from "@services/speech";
import { useAuthStore } from "@stores/pinia/auth";
import { useUserStore } from "@stores/pinia/user";

// ====================================================================
// SHAPES
//
// First-party shapes for the stage store. Kept intentionally permissive
// — most of this data originates as GraphQL responses or MQTT message
// bodies and carries fields beyond what the SPA reads, so each shape
// allows arbitrary extra keys via an index signature. The narrow
// fields here are the ones the store + its consumers actually touch.
// ====================================================================

export type ObjectId = string | number;

export interface BoardObject {
  id: ObjectId;
  type?: string;
  name?: string;
  src?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  opacity?: number;
  volume?: number;
  moveSpeed?: number;
  voice?: Record<string, unknown>;
  liveAction?: boolean;
  published?: boolean;
  displayName?: string;
  hostId?: ObjectId | null;
  drawingId?: string;
  textId?: string;
  wornBy?: ObjectId | null;
  multi?: boolean;
  frames?: string[];
  assetType?: { name?: string };
  description?: string;
  fontSize?: string;
  speak?: Speak | null;
  commands?: unknown;
  holder?: Session;
  [k: string]: unknown;
}

export interface ToolboxItem {
  id: ObjectId;
  name?: string;
  src?: string;
  url?: string;
  multi?: boolean;
  frames?: string[];
  assetType?: { name?: string };
  description?: string;
  fileLocation?: string;
  isPlaying?: boolean;
  changed?: boolean;
  [k: string]: unknown;
}

export interface Background {
  id?: ObjectId;
  at?: number;
  opacity?: number;
  // `speed` is the FADE duration: how long each crossfade between
  // consecutive frames takes (seconds). Set to 0 to pause the
  // animation entirely.
  speed?: number;
  // `dwell` is the HOLD duration: how long each frame stays at full
  // opacity *before* the next fade starts (seconds). Default
  // (undefined / 0) means "advance immediately when a fade
  // completes" — the legacy behaviour, kept so vintage broadcasts
  // and existing media animate exactly as they did before the
  // dwell field was introduced. The full per-frame cycle is
  // therefore `(speed + dwell)` seconds: a slideshow with `speed=1`
  // and `dwell=10` shows each image for 10s at full opacity, then
  // takes 1s to crossfade to the next.
  dwell?: number;
  src?: string;
  multi?: boolean;
  frames?: string[];
  [k: string]: unknown;
}

export interface Curtain {
  id?: ObjectId;
  src?: string;
  // Multi-frame curtain support (mirrors `Background`). When `multi` and
  // `frames` are present, `Curtain.vue` cycles through `frames` on a
  // setInterval driven by `speed` (FADE duration, seconds per
  // crossfade; 0 = paused) and `dwell` (HOLD duration, seconds the
  // frame stays at full opacity between fades; default 0 =
  // immediate advance, legacy behaviour). `currentFrame` is the
  // last-shown frame so audience joins land on the same picture the
  // performer sees. `at` is a timestamp used by `SET_CURTAIN` to
  // ignore stale MQTT messages.
  multi?: boolean;
  frames?: string[];
  speed?: number;
  dwell?: number;
  lastSpeed?: number;
  currentFrame?: string;
  at?: number;
  [k: string]: unknown;
}

/**
 * Stage model — GraphQL `stage` query response. The SPA reads a small
 * fixed set of fields, but the payload carries many more (attributes,
 * media subobjects, etc.). Extra keys are allowed via the index
 * signature; consumers that need them cast on read.
 */
export interface StageModel {
  id?: ObjectId;
  fileLocation?: string;
  cover?: string | null;
  name?: string;
  description?: string;
  status?: string;
  /** `"owner" | "editor" | "player" | "audience"` — string-typed because GraphQL also returns nulls and ad-hoc values. */
  permission?: string;
  assets?: ToolboxItem[];
  scenes?: Scene[];
  events?: ReplayEvent[];
  [k: string]: unknown;
}

export interface Scene {
  id: ObjectId;
  payload?: string;
  scenePreview?: boolean;
  [k: string]: unknown;
}

export interface ReplayEvent {
  id: ObjectId;
  mqttTimestamp: number;
  topic?: string;
  payload?: unknown;
  [k: string]: unknown;
}

export interface Speak {
  user?: string;
  message: string;
  behavior?: string;
  isPlayer?: boolean;
  isPrivate?: boolean;
  session?: string | null;
  at?: number;
  id?: string;
  hash?: string;
  [k: string]: unknown;
}

export interface ChatMessage {
  id?: string;
  user?: string;
  message?: string;
  behavior?: string;
  color?: string;
  hash?: string;
  at?: number;
  isPlayer?: boolean;
  isPrivate?: boolean;
  highlighted?: boolean;
  session?: string | null;
  clear?: boolean;
  clearPlayerChat?: boolean;
  remove?: string;
  highlight?: string;
  mute?: boolean;
  avatarId?: ObjectId;
  type?: string;
  [k: string]: unknown;
}

export interface Drawing {
  drawingId: string;
  commands?: unknown;
  [k: string]: unknown;
}

export interface TextEntity {
  textId: string;
  type?: string;
  [k: string]: unknown;
}

export interface WhiteboardCommand {
  [k: string]: unknown;
}

export interface JitsiTrack {
  // `getId` is the only lib-jitsi-meet method we invoke from typed code
  // (see ADD_TRACK dedupe). Declaring it here keeps the rest of the
  // interface loose while letting TS resolve the call signature; without
  // this, `track.getId?.()` narrows to `{}` and fails to typecheck.
  getId?: () => string | number | undefined;
  [k: string]: unknown;
}

export interface Session {
  id: string;
  isPlayer?: boolean;
  nickname?: string;
  at: number;
  avatarId?: ObjectId | null;
  leaving?: boolean;
  [k: string]: unknown;
}

export interface Reaction {
  reaction: unknown;
  x: number;
  y: number;
}

export interface AudioPlayer {
  currentTime?: number;
  [k: string]: unknown;
}

export interface StageConfig {
  animateDuration: number;
  reactionDuration: number;
  ratio: number;
  defaultcolor?: string;
  enabledLiveStreaming?: boolean;
  [k: string]: unknown;
}

export interface StageSettings {
  chatVisibility: boolean;
  chatDarkMode: boolean;
  reactionVisibility: boolean;
  [k: string]: unknown;
}

export interface Preferences {
  isDrawing: boolean;
  isWriting?: boolean;
  text: { fontSize: string; fontFamily: string };
  [k: string]: unknown;
}

/**
 * `color` carries a foreground/background pair when initialised
 * (`randomMessageColor()`), but `CLEAN_STAGE` historically reset it to
 * a bare hex string (`randomColor()`). Consumers tolerate both shapes,
 * so the type stays a union to preserve that legacy behaviour without
 * losing the rich object at init time.
 */
export type ChatColor = string | { text: string; bg: string };

export interface ChatState {
  messages: ChatMessage[];
  privateMessages: ChatMessage[];
  privateMessage: string;
  color: ChatColor;
  opacity: number;
  fontSize: string;
  playerFontSize: string;
  [k: string]: unknown;
}

export interface BoardState {
  objects: BoardObject[];
  drawings: Drawing[];
  texts: TextEntity[];
  whiteboard: WhiteboardCommand[];
  tracks: JitsiTrack[];
}

export interface ToolsState {
  avatars: ToolboxItem[];
  props: ToolboxItem[];
  backdrops: ToolboxItem[];
  audios: ToolboxItem[];
  meetings: ToolboxItem[];
  curtains: ToolboxItem[];
  [k: string]: ToolboxItem[];
}

export interface SettingPopup {
  isActive: boolean;
  [k: string]: unknown;
}

export interface PurchasePopup {
  isActive: boolean;
  amount?: number;
  [k: string]: unknown;
}

export interface ReceiptPopup {
  isActive: boolean;
  donationDetails: { amount: number; date: string; [k: string]: unknown };
}

export interface ReplayState {
  timestamp: { begin: number; end: number; current: number };
  timers: ReturnType<typeof setTimeout>[];
  interval: ReturnType<typeof setInterval> | null;
  speed: number;
  isReplaying?: boolean;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface StageSize {
  width: number;
  height: number;
  left: number;
  top: number;
}

export const useStageStore = defineStore("stage", () => {
  // ====================================================================
  // STATE
  // ====================================================================

  const preloading = ref<boolean>(true);
  const model = ref<StageModel | null>(null);
  const background = ref<Background | null>(null);
  const curtain = ref<Curtain | null>(null);
  const backdropColor = ref<string>("gray");
  const chatPosition = ref<string>("right");
  const status = ref<string>("OFFLINE");
  const subscribeSuccess = ref<boolean>(false);
  // Public-facing name is the `activeMovable` computed below; the raw ref
  // is the mutation target.
  const _activeMovable = ref<ObjectId | null>(null);

  const chat = ref<ChatState>({
    messages: [],
    privateMessages: [],
    privateMessage: "",
    color: randomMessageColor(),
    opacity: 0.9,
    fontSize: "14px",
    playerFontSize: "14px",
  });

  const board = ref<BoardState>({
    objects: [],
    drawings: [],
    texts: [],
    whiteboard: [],
    tracks: [],
  });

  const tools = ref<ToolsState>({
    avatars: [],
    props: [],
    backdrops: [],
    audios: [],
    meetings: [],
    curtains: [],
  });

  const _config = ref<StageConfig>(getDefaultStageConfig() as StageConfig);
  const settings = ref<StageSettings>(getDefaultStageSettings() as StageSettings);
  const settingPopup = ref<SettingPopup>({ isActive: false });
  const preferences = ref<Preferences>({
    isDrawing: false,
    text: { fontSize: "20px", fontFamily: "Josefin Sans" },
  });
  const reactions = ref<Reaction[]>([]);
  // Static placeholder; `useStageViewport()` (reactiveViewport.ts)
  // starts mutating this once App.vue mounts. TDZ caveat: do not call
  // `getViewport()` here — the helper depends on `window.innerWidth`
  // which is `0` during SSR / pre-mount Vite startup.
  const viewport = ref<Viewport>({ width: 0, height: 0 });
  const sessions = ref<Session[]>([]);
  const session = ref<string | null>(null);
  const replay = ref<ReplayState>({
    timestamp: { begin: 0, end: 0, current: 0 },
    timers: [],
    interval: null,
    speed: 1,
  });
  const audioPlayers = ref<AudioPlayer[]>([]);
  const isSavingScene = ref<boolean>(false);
  const isLoadingScenes = ref<boolean>(false);
  const showPlayerChat = ref<boolean>(false);
  const showClearChatSetting = ref<boolean>(false);
  const showDownloadChatSetting = ref<boolean>(false);
  // Epoch ms of the last seen private message. localStorage returns
  // `string | null`; coerce to a number on load so the unread-count
  // comparator (`m.at > lastSeenPrivateMessage.value`) and the
  // `SEEN_PRIVATE_MESSAGES` writer (which assigns `ChatMessage.at`)
  // both type-check.
  const lastSeenPrivateMessage = ref<number>(
    Number(localStorage.getItem("lastSeenPrivateMessage")) || 0,
  );
  const masquerading = ref<boolean>(false);
  const purchasePopup = ref<PurchasePopup>({ isActive: false });
  const receiptPopup = ref<ReceiptPopup>({
    isActive: false,
    donationDetails: { amount: 0, date: "" },
  });
  const _reloadStreams = ref<Date | null>(null);
  const _enabledLiveStreaming = ref<boolean>(true);

  // ====================================================================
  // GETTERS
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

  const preloadableAssets = computed<string[]>(() => {
    const assets: (string | undefined)[] = [];
    assets.push(...tools.value.avatars.filter((a) => !a.multi).map((a) => a.src));
    assets.push(
      ...tools.value.avatars
        .filter((a) => a.multi)
        .map((a) => a.frames ?? [])
        .flat(),
    );
    assets.push(...tools.value.props.filter((a) => !a.multi).map((p) => p.src));
    assets.push(
      ...tools.value.props
        .filter((a) => a.multi)
        .map((a) => a.frames ?? [])
        .flat(),
    );
    assets.push(...tools.value.backdrops.filter((a) => !a.multi).map((b) => b.src));
    assets.push(
      ...tools.value.backdrops
        .filter((a) => a.multi)
        .map((a) => a.frames ?? [])
        .flat(),
    );
    assets.push(...tools.value.curtains.filter((a) => !a.multi).map((b) => b.src));
    assets.push(
      ...tools.value.curtains
        .filter((a) => a.multi)
        .map((a) => a.frames ?? [])
        .flat(),
    );
    // Drop falsy so we never block on a slot that will never @load
    return assets.filter((src): src is string => Boolean(src));
  });

  const audios = computed(() => tools.value.audios);

  // Lazy `useUserStore()` lookup keeps the auth/user/stage import
  // graph acyclic — user.ts and stage.ts both import each other for
  // cross-store reads, so the resolution has to happen at call time.
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
    () =>
      chat.value.privateMessages.filter((m) => (m.at ?? 0) > lastSeenPrivateMessage.value).length,
  );

  const whiteboard = computed(() => board.value.whiteboard);

  const jitsiTracks = computed(() => board.value.tracks);

  const reloadStreams = computed(() => _reloadStreams.value);

  const activeObject = computed(() =>
    board.value.objects.find((o) => o.id == _activeMovable.value),
  );

  const enabledLiveStreaming = computed(() => _enabledLiveStreaming.value);

  // ====================================================================
  // MUTATIONS
  //
  // Plain functions that mutate the refs above. The UPPER_SNAKE_CASE
  // names are a stylistic hold-over from when these were Vuex
  // `commit(...)` targets — kept intact so the e2e dev hook and a few
  // call sites that pattern-match on the name don't need updating.
  // ====================================================================

  function SET_MODEL(newModel: StageModel | null) {
    model.value = newModel;
    if (newModel) {
      const media = newModel.assets;
      if (media && media.length) {
        media.forEach((item) => {
          if (item.assetType?.name === "video") {
            item.url = absolutePath(item.fileLocation ?? "");
          } else {
            if (item.description) {
              const meta = JSON.parse(item.description);
              delete item.description;
              Object.assign(item, meta);
            }
            item.src = absolutePath(item.fileLocation ?? "");
          }
          if (item.multi && item.frames) {
            item.frames = item.frames.map((src: string) => absolutePath(src));
          }
          const key = (item.assetType?.name ?? "") + "s";
          if (!tools.value[key]) {
            tools.value[key] = [];
          }
          tools.value[key].push(item);
        });
      } else {
        preloading.value = false;
      }
      // The persisted `config` attribute stores `ratio` as `{ width, height }`
      // (so authors can tweak the dimensions independently); the runtime
      // `_config.ratio` is the precomputed scalar. Type as `Record` to
      // sidestep the resulting shape mismatch with `Partial<StageConfig>`.
      const cfg = useAttribute({ value: newModel }, "config", true).value as
        | (Record<string, unknown> & {
            ratio?: { width: number; height: number };
            enabledLiveStreaming?: boolean;
            defaultcolor?: string;
          })
        | null;
      if (cfg) {
        Object.assign(_config.value, cfg);
        if (cfg.ratio && typeof cfg.ratio === "object") {
          _config.value.ratio = cfg.ratio.width / cfg.ratio.height;
        }
        _enabledLiveStreaming.value =
          typeof cfg?.enabledLiveStreaming === "boolean" ? cfg.enabledLiveStreaming : true;
      }
      // Match Stage Management default (#30AC45): new stages often have no
      // saved config yet, so do not leave backdropColor on CLEAN_STAGE's "gray".
      backdropColor.value = cfg?.defaultcolor || COLORS.DEFAULT_BACKDROP;
      const cover = useAttribute({ value: newModel }, "cover", false).value as string | undefined;
      newModel.cover = cover ? absolutePath(cover) : null;
    }
  }

  function CLEAN_STAGE(cleanModel?: boolean) {
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
    tools.value.curtains = [];
    _config.value = getDefaultStageConfig() as StageConfig;
    settings.value = getDefaultStageSettings() as StageSettings;
    board.value.objects = [];
    board.value.drawings = [];
    board.value.texts = [];
    board.value.whiteboard = [];
    chat.value.messages = [];
    chat.value.privateMessages = [];
    chat.value.color = randomColor();
  }

  function SET_BACKGROUND(bg: Background | null) {
    if (bg) {
      if (!background.value || !background.value.at || (background.value.at ?? 0) < (bg.at ?? 0)) {
        if (!background.value || background.value.id !== bg.id) {
          // Not playing animation if only opacity change
          animate("#board", { opacity: [0, 1], duration: 5000 });
        }
        background.value = bg;
      }
    }
  }

  function SET_STATUS(newStatus: string) {
    status.value = newStatus;
  }

  function SET_SUBSCRIBE_STATUS(s: boolean) {
    subscribeSuccess.value = s;
  }

  function PUSH_CHAT_MESSAGE(message: ChatMessage) {
    message.hash = hash(message as Record<string, unknown>);
    const lastMessage = chat.value.messages[chat.value.messages.length - 1];
    if (lastMessage && lastMessage.hash === message.hash) {
      return;
    }
    chat.value.messages.push(message);
  }

  function PUSH_PLAYER_CHAT_MESSAGE(message: ChatMessage) {
    message.hash = hash(message as Record<string, unknown>);
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

  function REMOVE_MESSAGE(id: string) {
    chat.value.messages = chat.value.messages.filter((m) => m.id !== id);
  }

  function HIGHLIGHT_MESSAGE(id: string) {
    const message = chat.value.messages.find((m) => m.id === id);
    if (message) {
      message.highlighted = !message.highlighted;
    }
  }

  function PUSH_OBJECT(object: BoardObject) {
    const { id } = object;
    deserializeObject(object);
    const m = board.value.objects.find((o) => o.id === id);
    if (m) {
      Object.assign(m, object);
    } else {
      board.value.objects.push(object);
    }
  }

  function UPDATE_OBJECT(object: BoardObject) {
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

  function DELETE_OBJECT(object: BoardObject) {
    const { id } = object;
    board.value.objects = board.value.objects.filter((o) => o.id !== id);
    board.value.objects
      .filter((o) => o.wornBy === id)
      .forEach((costume) => {
        costume.wornBy = null;
      });
  }

  function SET_OBJECT_SPEAK({
    avatar,
    speak,
    mute,
  }: {
    avatar: BoardObject;
    speak: Speak;
    mute?: boolean;
  }) {
    const { id } = avatar;
    const m = board.value.objects.find((o) => o.id === id);
    if (m) {
      speak.hash = hash(speak as Record<string, unknown>);
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

  function SET_PRELOADING_STATUS(s: boolean) {
    preloading.value = s;
  }

  function UPDATE_AUDIO(audio: ToolboxItem) {
    const m = tools.value.audios.find((a) => a.src === audio.src);
    if (m) {
      audio.changed = true;
      Object.assign(m, audio);
    }
  }

  function SET_SETTING_POPUP(setting: SettingPopup) {
    settingPopup.value = setting;
  }

  function SEND_TO_BACK(object: BoardObject) {
    const index = board.value.objects.findIndex((avatar) => avatar.id === object.id);
    if (index > -1) {
      board.value.objects.unshift(board.value.objects.splice(index, 1)[0]);
    }
  }

  function BRING_TO_FRONT(object: BoardObject) {
    const index = board.value.objects.findIndex((avatar) => avatar.id === object.id);
    if (index > -1) {
      board.value.objects.push(board.value.objects.splice(index, 1)[0]);
    }
  }

  function BRING_TO_FRONT_OF({ front, back }: { front: ObjectId; back: ObjectId }) {
    const frontIndex = board.value.objects.findIndex((avatar) => avatar.id === front);
    const backIndex = board.value.objects.findIndex((avatar) => avatar.id === back);
    if (frontIndex > -1 && backIndex > -1) {
      board.value.objects.splice(backIndex, 0, board.value.objects.splice(frontIndex, 1)[0]);
    }
  }

  function SET_PREFERENCES(prefs: Partial<Preferences>) {
    Object.assign(preferences.value, prefs);
  }

  function PUSH_DRAWING(drawing: Drawing) {
    board.value.drawings.push(cloneDeep(drawing));
  }

  function POP_DRAWING(drawingId: string) {
    board.value.drawings = board.value.drawings.filter((d) => d.drawingId !== drawingId);
  }

  function PUSH_TEXT(text: TextEntity) {
    board.value.texts.push(text);
  }

  function POP_TEXT(textId: string) {
    board.value.texts = board.value.texts.filter((d) => d.textId !== textId);
  }

  function UPDATE_IS_DRAWING(isDrawing: boolean) {
    preferences.value.isDrawing = isDrawing;
  }

  function UPDATE_IS_WRITING(isWriting: boolean) {
    preferences.value.isWriting = isWriting;
  }

  function UPDATE_TEXT_OPTIONS(options: Partial<Preferences["text"]>) {
    Object.assign(preferences.value.text, options);
  }

  function PUSH_REACTION(reaction: unknown) {
    reactions.value.push({
      reaction,
      x: randomRange(150, window.innerWidth) - 300,
      y: window.innerHeight - 100,
    });
    setTimeout(() => {
      reactions.value.shift();
    }, _config.value.reactionDuration);
  }

  function UPDATE_VIEWPORT(v: Viewport) {
    viewport.value = v;
  }

  function RESCALE_OBJECTS(ratio: number) {
    board.value.objects.forEach((object) => {
      object.x = object.x * ratio;
      object.y = object.y * ratio;
      object.w = object.w * ratio;
      object.h = object.h * ratio;
      recalcFontSize(object, (s: number) => s * ratio);
    });
  }

  function SET_CHAT_PARAMETERS({ opacity, fontSize }: { opacity: number; fontSize: string }) {
    chat.value.opacity = opacity;
    chat.value.fontSize = fontSize;
  }

  function SET_PLAYER_CHAT_PARAMETERS({ playerFontSize }: { playerFontSize: string }) {
    chat.value.playerFontSize = playerFontSize;
  }

  function UPDATE_SESSIONS_COUNTER(s: Session) {
    // Session ids can arrive as either string (anonymous uuidv4) or as a
    // numeric DB user id depending on whether the publisher is logged in;
    // dedupe by stringified value so the same human never doubles up.
    const sid = s.id != null ? String(s.id) : s.id;
    const index = sessions.value.findIndex((x) => (x.id != null ? String(x.id) : x.id) === sid);
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

  function SET_CHAT_VISIBILITY(visible: boolean) {
    settings.value.chatVisibility = visible;
  }

  function SET_DARK_MODE_CHAT(enabled: boolean) {
    settings.value.chatDarkMode = enabled;
  }

  function SET_REACTION_VISIBILITY(visible: boolean) {
    settings.value.reactionVisibility = visible;
  }

  function SET_CHAT_POSITION(position: string) {
    chatPosition.value = position;
  }

  function SET_BACKDROP_COLOR(color: string) {
    backdropColor.value = color;
  }

  function SET_REPLAY(r: Partial<ReplayState>) {
    Object.assign(replay.value, r);
  }

  function SET_ACTIVE_MOVABLE(id: ObjectId | null) {
    _activeMovable.value = id;
  }

  function UPDATE_AUDIO_PLAYER_STATUS({
    index,
    ...statusUpdate
  }: { index: number } & Record<string, unknown>) {
    if (!audioPlayers.value[index]) {
      audioPlayers.value[index] = {};
    }
    Object.assign(audioPlayers.value[index], statusUpdate);
  }

  function SET_CURTAIN(c: Curtain | string | null) {
    if (c == null) {
      curtain.value = null;
      return;
    }
    // Legacy path: older clients publish DRAW_CURTAIN with `curtain: "<src>"`
    // (a bare URL string). Normalize to the object shape so the renderer
    // only has to deal with one type.
    const normalized: Curtain = typeof c === "string" ? { src: c } : c;
    // Stale-message guard, mirrors SET_BACKGROUND: only accept strictly
    // newer messages. Same-`at` is treated as a stale echo (this is what
    // happens for the sender's own broker echo after drawCurtain applied
    // the change locally) and silently dropped to avoid the watch in
    // `Curtain.vue` resetting the frame interval. Messages without `at`
    // (older clients) bypass the guard and always win.
    if (
      curtain.value &&
      curtain.value.at != null &&
      normalized.at != null &&
      normalized.at <= curtain.value.at
    ) {
      return;
    }
    curtain.value = normalized;
  }

  /**
   * Scene snapshot shape. Snapshots are produced by
   * `takeSnapshotFromStage` (see reusable.ts) and stored as JSON
   * strings inside `Scene.payload`. The snapshot's `audios` key maps
   * to `tools.audios` (the only place that field is read), not a
   * top-level state ref.
   */
  interface SceneSnapshot {
    background?: Background | null;
    backdropColor?: string;
    board?: BoardState;
    settings?: StageSettings;
    audioPlayers?: AudioPlayer[];
    audios?: ToolboxItem[];
  }

  function REPLACE_SCENE({ payload }: { payload?: string | null }) {
    animate("#live-stage", {
      filter: ["brightness(0)", "brightness(1)"],
      ease: "linear",
      duration: 3000,
    });
    _activeMovable.value = null;
    if (payload) {
      const snapshot: SceneSnapshot = JSON.parse(payload);
      if (snapshot.board) {
        snapshot.board.objects.forEach(deserializeObject);
        snapshot.board.tracks = board.value.tracks;
      }
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

  function SET_SAVING_SCENE(v: boolean) {
    isSavingScene.value = v;
  }

  function SET_SHOW_PLAYER_CHAT(v: boolean) {
    showPlayerChat.value = v;
  }

  function SET_SHOW_CLEAR_CHAT_SETTINGS(v: boolean) {
    showClearChatSetting.value = v;
  }

  function SET_SHOW_DOWNLOAD_CHAT_SETTINGS(v: boolean) {
    showDownloadChatSetting.value = v;
  }

  function TAG_PLAYER(player: { nickname: string }) {
    chat.value.privateMessage += `@${player.nickname.trim()}`;
  }

  function SEEN_PRIVATE_MESSAGES() {
    const length = chat.value.privateMessages.length;
    if (length > 0) {
      lastSeenPrivateMessage.value = chat.value.privateMessages[length - 1].at ?? 0;
      localStorage.setItem("lastSeenPrivateMessage", String(lastSeenPrivateMessage.value));
    }
  }

  /**
   * Whiteboard draw message envelope. `command` is a single segment for
   * NEW_LINE and unused for UNDO/CLEAR; `index` is required for UNDO.
   */
  interface DrawMessage {
    type: string;
    command?: WhiteboardCommand;
    index?: number;
  }

  function UPDATE_WHITEBOARD(message: DrawMessage) {
    if (!board.value.whiteboard) {
      board.value.whiteboard = [];
    }
    switch (message.type) {
      case DRAW_ACTIONS.NEW_LINE:
        if (message.command) {
          board.value.whiteboard = board.value.whiteboard.concat(message.command);
        }
        break;
      case DRAW_ACTIONS.UNDO:
        board.value.whiteboard = board.value.whiteboard.filter((_e, i) => i !== message.index);
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

  function CREATE_ROOM(room: ToolboxItem) {
    tools.value.meetings.push(room);
  }

  /**
   * Reorder shape: `from`/`to` are either a Scene, Drawing, TextEntity,
   * or a ToolboxItem (in which case `from.type` names the tool group).
   */
  interface ReorderItem {
    id?: ObjectId;
    scenePreview?: boolean;
    drawingId?: string;
    textId?: string;
    type?: string;
  }

  function REORDER_TOOLBOX({ from, to }: { from: ReorderItem; to: ReorderItem }) {
    console.log(from, to);
    if (from.scenePreview) {
      // is scene
      const scenes = model.value?.scenes;
      if (!scenes) return;
      const fromIndex = scenes.findIndex((t) => t.id === from.id);
      const toIndex = scenes.findIndex((t) => t.id === to.id);
      if (fromIndex > -1 && toIndex > -1) {
        const tool = scenes.splice(fromIndex, 1)[0];
        scenes.splice(toIndex, 0, tool);
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
      const toolName = (from.type ?? "") + "s";
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

  function SET_PURCHASE_POPUP(purchase: PurchasePopup) {
    purchasePopup.value = purchase;
    if (purchase.isActive) {
      receiptPopup.value.donationDetails = {
        ...purchase,
        amount: purchase.amount ?? 0,
        date: new Date().toLocaleDateString(),
      };
    }
  }

  function ADD_TRACK(track: JitsiTrack) {
    // Re-place by JitsiTrack id rather than skipping a duplicate. The
    // Yourself.vue dragstart path can publish the local track here
    // before lib-jitsi-meet has finished assigning it a participantId;
    // the conference's TRACK_ADDED then re-publishes the same
    // JitsiTrack instance after the assignment. We must not silently
    // drop that republish — Jitsi.vue's per-participantId filter is a
    // Vue computed and only re-evaluates when board.value.tracks
    // changes (it cannot observe a JS method call on a non-reactive
    // JitsiTrack), so swapping in a new array reference is the only
    // way the local user's own on-stage tile recovers from the
    // "ownerless early add" state.
    const id = track.getId?.();
    if (id !== undefined) {
      const existingIdx = board.value.tracks.findIndex((t) => t.getId?.() === id);
      if (existingIdx !== -1) {
        const next = [...board.value.tracks];
        next[existingIdx] = track;
        board.value.tracks = next;
        return;
      }
    }
    board.value.tracks = [...board.value.tracks, track];
  }

  function RELOAD_STREAMS() {
    _reloadStreams.value = new Date();
  }

  function OPEN_RECEIPT_POPUP(_payload?: unknown) {
    receiptPopup.value.isActive = true;
  }

  function CLOSE_RECEIPT_POPUP() {
    receiptPopup.value.isActive = false;
  }

  // ====================================================================
  // MQTT CLIENT WRAPPER
  //
  // `buildClient()` returns an unconnected wrapper. The underlying
  // broker connection only opens when the `connect()` action below is
  // invoked. Pinia setup functions run exactly once per store (the
  // result is memoized) so we get a single wrapper instance per app
  // lifetime.
  // ====================================================================
  const mqtt = buildClient();

  // ====================================================================
  // ACTIONS
  //
  // Plain functions that call mutations and each other. Function
  // declarations are hoisted, so cross-references (e.g. `connect`
  // calls `subscribe` which is defined later) work without ordering
  // pain.
  // ====================================================================

  /**
   * Minimal contract for the broker client returned by `buildClient()`.
   * `src/services/mqtt.ts` is `@ts-nocheck` and infers `.client = null`
   * at construction, so without an assertion here every `client.on(...)`
   * trips up on `never`. Only the listener channels we actually wire are
   * declared.
   */
  type MqttClient = {
    on(event: "connect" | "reconnect" | "close" | "disconnect" | "offline", cb: () => void): void;
    on(event: "error", cb: (err: { message?: string } | undefined) => void): void;
  };

  function connect() {
    SET_STATUS("CONNECTING");
    const client = mqtt.connect() as MqttClient | null;
    if (!client) return;
    client.on("connect", () => {
      SET_STATUS("LIVE");
      void reloadMissingEvents();
      subscribe();
      // Hydrate the current user before announcing presence so joinStage()
      // can use the canonical DB user id rather than a placeholder uuid
      // (which would change on every refresh and look like a new viewer).
      void (async () => {
        const userStore = useUserStore();
        if (useAuthStore().loggedIn && userStore.user?.id == null) {
          try {
            await userStore.fetchCurrent();
          } catch (err) {
            console.warn("[stage] fetchCurrent before joinStage failed:", err);
          }
        }
        await joinStage();
      })();
    });
    client.on("error", (err) => {
      console.error("[MQTT] Stage client error:", err?.message ?? err);
      SET_STATUS("OFFLINE");
    });
    client.on("reconnect", () => SET_STATUS("CONNECTING"));
    client.on("close", () => SET_STATUS("OFFLINE"));
    client.on("disconnect", () => SET_STATUS("OFFLINE"));
    client.on("offline", () => SET_STATUS("OFFLINE"));
    mqtt.receiveMessage((payload: { topic: string; message: unknown }) => handleMessage(payload));
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

  /**
   * Generic broker envelope. The dispatch table below narrows `message`
   * to a more specific shape per `topic`.
   */
  interface MqttEnvelope {
    topic: string;
    message: unknown;
  }

  function handleMessage({ topic, message }: MqttEnvelope) {
    switch (topic) {
      case TOPICS.CHAT:
        handleChatMessage({ message: message as ChatMessage });
        break;
      case TOPICS.BOARD:
        handleBoardMessage({ message: message as BoardMessage });
        break;
      case TOPICS.BACKGROUND:
        handleBackgroundMessage({ message: message as BackgroundMessage });
        break;
      case TOPICS.AUDIO:
        handleAudioMessage({ message: message as ToolboxItem });
        break;
      case TOPICS.REACTION:
        handleReactionMessage({ message });
        break;
      case TOPICS.COUNTER:
        handleCounterMessage({ message: message as Session });
        break;
      case TOPICS.DRAW:
        handleDrawMessage({ message: message as DrawMessage });
        break;
      default:
        break;
    }
  }

  function sendChat({ message, isPrivate }: { message: string; isPrivate?: boolean }) {
    if (!message) return;
    let user = useUserStore().chatname;
    let isPlayer: boolean = !!canPlay.value;
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
    const payload: Speak = {
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
  function speakAsAvatar({ message, behavior }: { message: string; behavior?: string }) {
    if (!message) return;
    const avatar = currentAvatar.value;
    if (!avatar) return;
    const isPlayer = canPlay.value;
    if (!isPlayer) return;
    const finalBehavior = behavior === "shout" || behavior === "think" ? behavior : "speak";
    const finalMessage = finalBehavior === "shout" ? String(message).toUpperCase() : message;
    const speak: Speak = {
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

  function handleChatMessage({ message }: { message: ChatMessage | string }) {
    // String fall-through for legacy plain-text MQTT chat publishers.
    if (typeof message !== "object" || message === null) {
      const stringMessage: ChatMessage = {
        user: "Anonymous",
        color: "#000000",
        message: String(message),
      };
      PUSH_CHAT_MESSAGE(stringMessage);
      return;
    }
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
    const m: ChatMessage = {
      user: "Anonymous",
      color: "#000000",
      ...message,
    };
    if (message.isPrivate) {
      PUSH_PLAYER_CHAT_MESSAGE(m);
      if ((message.at ?? 0) > lastSeenPrivateMessage.value) {
        if (showPlayerChat.value) {
          SEEN_PRIVATE_MESSAGES();
        } else {
          const nickname = useUserStore().nickname ?? "";
          if (message.message?.toLowerCase().includes(`@${nickname.trim().toLowerCase()}`)) {
            setShowPlayerChat(true);
          }
        }
      }
    } else {
      PUSH_CHAT_MESSAGE(m);
    }
  }

  function placeObjectOnStage(
    data: Partial<BoardObject> & {
      assetType?: { name?: string };
      type?: string;
      description?: string;
    },
  ): BoardObject {
    const object: BoardObject = {
      w: 100,
      h: 100,
      opacity: 1,
      moveSpeed: 2000,
      voice: {},
      volume: 100,
      rotate: 0,
      // Fresh objects start in the "white" lightbulb state: not
      // broadcast yet, grayscale on the performer's view, invisible to
      // everyone else. The performer publishes by clicking the bulb,
      // which flips `liveAction` to `true` and triggers shapeObject's
      // first PLACE_OBJECT_ON_STAGE. (Previously this defaulted to
      // `true`, which auto-broadcast on the next drag — see
      // QuickAction.vue tri-state classes for the visual mapping.)
      liveAction: false,
      x: 0,
      y: 0,
      ...data,
      id: uuidv4(),
      type: data.assetType?.name || data.type,
    };
    if (object.type === "video") {
      object.hostId = session.value;
      // Start playing as soon as the video is placed on stage so the
      // performer doesn't have to right-click -> Play to start every
      // newly-dragged clip. The user can still toggle pause/play via the
      // avatar context menu (ContextMenuAvatar.vue play/pause actions).
      if (object.isPlaying === undefined) {
        object.isPlaying = true;
      }
      try {
        const description = JSON.parse(data.description ?? "");
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

  function shapeObject(object: BoardObject) {
    // Sender always reflects their own change locally. This used to live
    // only in the `else` branch and the live branch relied on the broker
    // echo to update the sender's store. Now that `serializeForBroadcast`
    // strips `liveAction` from outgoing payloads, the echo is no longer a
    // safe round-trip for sender-local UI state — so apply locally first
    // unconditionally. UPDATE_OBJECT is idempotent, so the echo from the
    // broker is a harmless no-op for the sender.
    UPDATE_OBJECT(serializeObject(object));
    if (object.liveAction) {
      if (object.published) {
        mqtt.sendMessage(TOPICS.BOARD, {
          type: BOARD_ACTIONS.MOVE_TO,
          object: serializeForBroadcast(object),
        });
      } else {
        object.published = true;
        object.displayName = useUserStore().nickname ?? "";
        mqtt.sendMessage(TOPICS.BOARD, {
          type: BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE,
          object: serializeForBroadcast(object),
        });
      }
      board.value.objects
        .filter((o) => o.wornBy === object.id)
        .forEach((costume) => {
          if (!costume.published) {
            costume.published = true;
            // Flip the child's local lightbulb to green at the same
            // time we publish it. Without this the child would stay
            // `liveAction:false, published:true` (the "red" state) even
            // though it's actively broadcasting with its parent, which
            // would mislead the performer about its live status.
            costume.liveAction = true;
            mqtt.sendMessage(TOPICS.BOARD, {
              type: BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE,
              object: serializeForBroadcast(costume),
            });
          }
        });
    }
  }

  // Bypass actions (switchFrame, toggleAutoplayFrames, sendToBack,
  // bringToFront, bringToFrontOf, deleteObject) previously published
  // unconditionally — that's the second half of the lightbulb leak: while
  // the bulb is off, the audience was still seeing frame switches, z-order
  // changes, autoplay toggles, and deletes happen live. Each wrapper below
  // now applies the change locally first (so the performer always sees
  // their own action), and only publishes if `liveAction` is on.
  function deleteObject(object: BoardObject) {
    const localPayload = serializeObject(object);
    if (localPayload.drawingId) {
      // is drawing
      delete localPayload.commands;
    }
    DELETE_OBJECT(localPayload);
    if (object.liveAction) {
      const wirePayload = serializeForBroadcast(object);
      if (wirePayload.drawingId) {
        delete wirePayload.commands;
      }
      mqtt.sendMessage(TOPICS.BOARD, {
        type: BOARD_ACTIONS.DESTROY,
        object: wirePayload,
      });
    }
    // Full-gate-with-delete caveat: if the bulb is off, the delete is
    // sender-local. The object disappears from the performer's view (and
    // so does the bulb), so this session has no way to re-broadcast the
    // deletion to the audience. Documented intent of "full gate".
  }

  function switchFrame(object: BoardObject) {
    UPDATE_OBJECT(serializeObject(object));
    if (object.liveAction) {
      mqtt.sendMessage(TOPICS.BOARD, {
        type: BOARD_ACTIONS.SWITCH_FRAME,
        object: serializeForBroadcast(object),
      });
    }
  }

  function sendToBack(object: BoardObject) {
    SEND_TO_BACK(object);
    if (object.liveAction) {
      mqtt.sendMessage(TOPICS.BOARD, {
        type: BOARD_ACTIONS.SEND_TO_BACK,
        object: serializeForBroadcast(object),
      });
    }
  }

  function bringToFront(object: BoardObject) {
    BRING_TO_FRONT(object);
    if (object.liveAction) {
      mqtt.sendMessage(TOPICS.BOARD, {
        type: BOARD_ACTIONS.BRING_TO_FRONT,
        object: serializeForBroadcast(object),
      });
    }
  }

  function bringToFrontOf({ front, back }: { front: ObjectId; back: ObjectId }) {
    BRING_TO_FRONT_OF({ front, back });
    // The "moved" object is `front`; gate the publish on its bulb.
    const frontObj = board.value.objects.find((o) => o.id === front);
    if (frontObj?.liveAction) {
      mqtt.sendMessage(TOPICS.BOARD, {
        type: BOARD_ACTIONS.BRING_TO_FRONT_OF,
        front,
        back,
      });
    }
  }

  function toggleAutoplayFrames(object: BoardObject) {
    UPDATE_OBJECT(serializeObject(object));
    if (object.liveAction) {
      mqtt.sendMessage(TOPICS.BOARD, {
        type: BOARD_ACTIONS.TOGGLE_AUTOPLAY_FRAMES,
        object: serializeForBroadcast(object),
      });
    }
  }

  /**
   * Board topic envelope. Different `type` values carry different
   * payloads (object/avatar+speak/front+back); express the union loosely
   * and narrow at each case site.
   */
  interface BoardMessage {
    type: string;
    object?: BoardObject;
    avatar?: BoardObject;
    speak?: Speak;
    mute?: boolean;
    front?: ObjectId;
    back?: ObjectId;
  }

  function handleBoardMessage({ message }: { message: BoardMessage }) {
    switch (message.type) {
      case BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE:
        if (message.object) {
          // The broadcast strips `liveAction` (serializeForBroadcast),
          // so incoming objects arrive without it. From the receiver's
          // point of view the object IS live — someone just published
          // it — so treat it as `liveAction:true, published:true` even
          // though those fields weren't on the wire. This keeps the
          // performer-side lightbulb green (rather than the initial
          // "never published" white) for objects placed by collaborators,
          // and keeps the moveable in full color (Moveable.vue grayscale
          // matches `liveAction === false`).
          PUSH_OBJECT({ ...message.object, liveAction: true, published: true });
        }
        break;
      case BOARD_ACTIONS.MOVE_TO:
        if (message.object) UPDATE_OBJECT(message.object);
        break;
      case BOARD_ACTIONS.DESTROY:
        if (message.object) DELETE_OBJECT(message.object);
        break;
      case BOARD_ACTIONS.SWITCH_FRAME:
        if (message.object) UPDATE_OBJECT(message.object);
        break;
      case BOARD_ACTIONS.SPEAK:
        if (message.avatar && message.speak) {
          SET_OBJECT_SPEAK({ avatar: message.avatar, speak: message.speak, mute: message.mute });
        }
        break;
      case BOARD_ACTIONS.SEND_TO_BACK:
        if (message.object) SEND_TO_BACK(message.object);
        break;
      case BOARD_ACTIONS.BRING_TO_FRONT:
        if (message.object) BRING_TO_FRONT(message.object);
        break;
      case BOARD_ACTIONS.BRING_TO_FRONT_OF:
        if (message.front !== undefined && message.back !== undefined) {
          BRING_TO_FRONT_OF({ front: message.front, back: message.back });
        }
        break;
      case BOARD_ACTIONS.TOGGLE_AUTOPLAY_FRAMES:
        if (message.object) UPDATE_OBJECT(message.object);
        break;
      default:
        break;
    }
  }

  function setBackground(bg: Background) {
    bg.at = +new Date();
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.CHANGE_BACKGROUND,
      background: bg,
    });
  }

  function showChatBox(visible: boolean) {
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.SET_CHAT_VISIBILITY,
      visible,
    });
  }

  function enableDarkModeChat(enabled: boolean) {
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.SET_DARK_MODE_CHAT,
      enabled,
    });
  }

  function showReactionsBar(visible: boolean) {
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.SET_REACTION_VISIBILITY,
      visible,
    });
  }

  function setChatPosition(position: string) {
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.SET_CHAT_POSITION,
      position,
    });
  }

  function setBackdropColor(color: string) {
    console.log("SET_BACKDROP_COLOR", color);
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.SET_BACKDROP_COLOR,
      color,
    });
  }

  function drawCurtain(c: Curtain | string | null) {
    // Accept legacy `string` callers (older code paths or scenes saved
    // before the multi-frame change) and normalize to the object shape.
    let payload: Curtain | null;
    if (c == null) {
      payload = null;
    } else if (typeof c === "string") {
      payload = { src: c, at: +new Date() };
    } else {
      payload = { ...c, at: +new Date() };
    }
    // Apply locally first so the sender's view doesn't depend on the
    // broker echo, mirroring how `setBackground` -> `SET_BACKGROUND` is
    // wired plus the recent UPDATE_OBJECT-first convention. Broker echo
    // is a harmless no-op because of the `at`-based guard.
    SET_CURTAIN(payload);
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.DRAW_CURTAIN,
      curtain: payload,
    });
  }

  // Mirrors Backdrops.vue's toggleAutoplayFrames: pause if already
  // animating (stash current speed in lastSpeed), or resume to lastSpeed
  // (falling back to 0.5 s/frame so users can play immediately even if
  // they never set a speed).
  function toggleCurtainAutoplay() {
    if (!curtain.value) return;
    let nextSpeed = 0;
    if (!curtain.value.speed) {
      nextSpeed = curtain.value.lastSpeed ?? 0.5;
    }
    drawCurtain({
      ...curtain.value,
      lastSpeed: curtain.value.speed,
      speed: nextSpeed,
    });
  }

  function setCurtainSpeed(speed: number) {
    if (!curtain.value) return;
    drawCurtain({
      ...curtain.value,
      speed: speed ?? 0,
    });
  }

  // Companion to setCurtainSpeed: fade vs hold are independent knobs.
  // See the `Curtain.dwell` doc on the interface for the full
  // model. Threaded through drawCurtain so every client (and the
  // sender's local view via the optimistic SET_CURTAIN call inside
  // drawCurtain) picks up the new value on the next animation tick.
  function setCurtainDwell(dwell: number) {
    if (!curtain.value) return;
    drawCurtain({
      ...curtain.value,
      dwell: dwell ?? 0,
    });
  }

  function setCurtainFrame(currentFrame: string) {
    if (!curtain.value) return;
    drawCurtain({
      ...curtain.value,
      currentFrame,
    });
  }

  function loadScenes() {
    mqtt.sendMessage(TOPICS.BACKGROUND, {
      type: BACKGROUND_ACTIONS.LOAD_SCENES,
    });
  }

  function switchScene(scene: ObjectId) {
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

  /**
   * Background topic envelope. Each `type` carries a small distinct
   * payload (visible/enabled/color/etc.); fields are all optional, and
   * each case site reads only the ones it expects.
   */
  interface BackgroundMessage {
    type: string;
    background?: Background | null;
    visible?: boolean;
    enabled?: boolean;
    position?: string;
    color?: string;
    // Older clients send `curtain: "<src-string>"`; SET_CURTAIN handles
    // both via a legacy-string adapter.
    curtain?: Curtain | string | null;
    scene?: ObjectId;
  }

  function handleBackgroundMessage({ message }: { message: BackgroundMessage }) {
    switch (message.type) {
      case BACKGROUND_ACTIONS.CHANGE_BACKGROUND:
        SET_BACKGROUND(message.background ?? null);
        break;
      case BACKGROUND_ACTIONS.SET_CHAT_VISIBILITY:
        if (message.visible !== undefined) SET_CHAT_VISIBILITY(message.visible);
        break;
      case BACKGROUND_ACTIONS.SET_DARK_MODE_CHAT:
        if (message.enabled !== undefined) SET_DARK_MODE_CHAT(message.enabled);
        break;
      case BACKGROUND_ACTIONS.SET_REACTION_VISIBILITY:
        if (message.visible !== undefined) SET_REACTION_VISIBILITY(message.visible);
        break;
      case BACKGROUND_ACTIONS.SET_CHAT_POSITION:
        if (message.position !== undefined) SET_CHAT_POSITION(message.position);
        break;
      case BACKGROUND_ACTIONS.SET_BACKDROP_COLOR:
        if (message.color !== undefined) SET_BACKDROP_COLOR(message.color);
        break;
      case BACKGROUND_ACTIONS.DRAW_CURTAIN:
        SET_CURTAIN(message.curtain ?? null);
        break;
      case BACKGROUND_ACTIONS.LOAD_SCENES:
        void reloadScenes();
        break;
      case BACKGROUND_ACTIONS.SWITCH_SCENE:
        if (message.scene !== undefined) replaceScene(message.scene);
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

  function updateAudioStatus(audio: ToolboxItem) {
    mqtt.sendMessage(TOPICS.AUDIO, audio);
  }

  function handleAudioMessage({ message }: { message: ToolboxItem }) {
    UPDATE_AUDIO(message);
  }

  function closeSettingPopup() {
    SET_SETTING_POPUP({ isActive: false });
  }

  function openSettingPopup(setting: SettingPopup) {
    setting.isActive = true;
    SET_SETTING_POPUP(setting);
  }

  function addDrawing(drawing: Drawing) {
    PUSH_DRAWING(drawing);
    placeObjectOnStage(drawing as Partial<BoardObject>);
  }

  function addText(text: TextEntity) {
    text.type = "text";
    PUSH_TEXT(text);
    placeObjectOnStage(text as Partial<BoardObject>);
  }

  function handleReactionMessage({ message }: { message: unknown }) {
    PUSH_REACTION(message);
  }

  function sendReaction(reaction: unknown) {
    mqtt.sendMessage(TOPICS.REACTION, reaction);
  }

  async function loadStage({ url, recordId }: { url: string; recordId?: string }) {
    CLEAN_STAGE(true);
    SET_PRELOADING_STATUS(true);
    try {
      const { stage } = await stageGraph.loadStage(url, recordId);
      if (stage) {
        SET_MODEL(stage);
        const { events } = stage as StageModel;
        if (recordId && events && events.length > 0) {
          SET_REPLAY({
            timestamp: {
              begin: events[0].mqttTimestamp,
              current: events[0].mqttTimestamp,
              end: events[events.length - 1].mqttTimestamp,
            },
          });
        } else {
          (events ?? []).forEach((event: ReplayEvent) => replayEvent(event));
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
    if (!model.value?.fileLocation) return;
    const { stage } = await stageGraph.loadStage(model.value.fileLocation);
    if (stage && model.value) {
      model.value.permission = stage.permission;
    }
  }

  async function loadPermission() {
    const permission = model.value?.permission;
    if (permission == "owner" || permission == "editor" || permission == "player") {
      SET_SHOW_CLEAR_CHAT_SETTINGS(true);
      SET_SHOW_DOWNLOAD_CHAT_SETTINGS(true);
    } else {
      SET_SHOW_CLEAR_CHAT_SETTINGS(false);
      SET_SHOW_DOWNLOAD_CHAT_SETTINGS(false);
    }
  }

  async function reloadScenes() {
    if (!model.value?.fileLocation) return;
    isLoadingScenes.value = true;
    const scenes = await stageGraph.loadScenes(model.value.fileLocation);
    if (scenes && model.value) {
      model.value.scenes = scenes;
    }
    isLoadingScenes.value = false;
  }

  async function reloadMissingEvents() {
    if (!model.value?.fileLocation || !model.value.events) return;
    const lastEventId = model.value.events[model.value.events.length - 1]?.id ?? 0;
    const events = await stageGraph.loadEvents(model.value.fileLocation, lastEventId);
    if (events && model.value.events) {
      events.forEach((event: ReplayEvent) => replicateEvent(event));
      model.value.events = model.value.events.concat(events);
    }
  }

  function replaceScene(sceneId: ObjectId) {
    animate("#live-stage", {
      filter: "brightness(0)",
    });
    const scene = model.value?.scenes?.find((s) => s.id == sceneId);
    if (scene) {
      REPLACE_SCENE({ payload: scene.payload ?? null });
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
  function replayEvent({ topic, payload }: ReplayEvent) {
    const clone = JSON.parse(JSON.stringify(payload));
    handleMessage({
      topic: unnamespaceTopic(topic ?? ""),
      message: clone,
    });
  }

  function replicateEvent({ topic, payload }: ReplayEvent) {
    // Same shared-reference hazard as `replayEvent` — see comment there.
    const message = JSON.parse(JSON.stringify(payload));
    message.mute = true;
    handleMessage({
      topic: unnamespaceTopic(topic ?? ""),
      message,
    });
  }

  async function replayRecording(timestamp?: number | string) {
    stopSpeaking();
    pauseReplay();
    const current =
      timestamp !== undefined && timestamp !== null
        ? Number(timestamp)
        : replay.value.timestamp.begin;
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
    const events = model.value?.events ?? [];
    const speed = replay.value.speed;
    replay.value.interval = setInterval(() => {
      replay.value.timestamp.current += 1;
      if (replay.value.timestamp.current > replay.value.timestamp.end) {
        replay.value.timestamp.current = replay.value.timestamp.begin;
        pauseReplay();
      }
    }, 1000 / speed);
    events.forEach((event: ReplayEvent) => {
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

  /**
   * Tear down the active replay loop. Called both from the top of
   * `replayRecording` (to clear any previous interval/timers before
   * starting a fresh replay) and from inside the 1Hz interval body
   * when `current` runs past `end`. The natural-end call must flip
   * `isReplaying` back to `false` so consumers waiting on the end
   * of replay (notably `perform.spec.ts`, which polls
   * `stage.replay.isReplaying === false` after the recording's
   * wall-clock duration) actually unblock. The `replayRecording`
   * call site immediately re-sets `isReplaying = true` afterwards,
   * so the temporary flip is invisible there.
   */
  function pauseReplay() {
    if (replay.value.interval !== null) {
      clearInterval(replay.value.interval);
    }
    replay.value.interval = null;
    replay.value.timers.forEach((timer) => clearTimeout(timer));
    replay.value.timers = [];
    tools.value.audios.forEach((audio) => {
      audio.isPlaying = false;
      audio.changed = true;
    });
    replay.value.isReplaying = false;
  }

  function seekForwardReplay() {
    const current = replay.value.timestamp.current + 10000;
    const nextEvent = model.value?.events?.find((e) => e.mqttTimestamp > current);
    if (nextEvent) {
      void replayRecording(nextEvent.mqttTimestamp);
    }
  }

  function seekBackwardReplay() {
    const current = replay.value.timestamp.current - 10000;
    const events = model.value?.events ?? [];
    let event: ReplayEvent | null = null;
    for (let i = events.length - 1; i >= 0; i--) {
      event = events[i];
      if (event.mqttTimestamp < current) {
        break;
      }
    }
    if (event) {
      void replayRecording(event.mqttTimestamp);
    }
  }

  function handleCounterMessage({ message }: { message: Session }) {
    UPDATE_SESSIONS_COUNTER(message);
    if (message.id === session.value && message.avatarId) {
      useUserStore().avatarId = message.avatarId;
    }
  }

  async function joinStage() {
    const userStore = useUserStore();
    const isPlayer = useAuthStore().loggedIn;
    // Derive a stable session id every join: for logged-in performers the
    // canonical DB user id (stringified), reserving uuidv4() only for true
    // anonymous audience. Without this, an MQTT connect that fires before
    // userStore.fetchCurrent() returns would mint a uuid and stick with it
    // across the session, causing a fresh "viewer" on every page refresh
    // (the previous uuid lingers in other clients' sessions lists).
    if (isPlayer && userStore.user?.id != null) {
      session.value = String(userStore.user.id);
    } else if (!session.value) {
      session.value = uuidv4();
    }
    const id = session.value;
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
    // Use fire-and-forget so this works from browser-unload handlers
    // (beforeunload / pagehide), where awaiting the broker ACK would
    // race the page tear-down and the leave message would never reach
    // the wire. The fallback to retry on dropped sockets is the 60-min
    // client-side trim in UPDATE_SESSIONS_COUNTER.
    mqtt.sendMessageSync(TOPICS.COUNTER, { id, leaving: true });
  }

  // Synchronous unload path used from beforeunload / pagehide. Skips the
  // awaited statistics-rebroadcast (which would never finish) and just
  // emits the leave message + clears local state.
  function disconnectSync() {
    const id = session.value;
    if (id != null) {
      mqtt.sendMessageSync(TOPICS.COUNTER, { id, leaving: true });
    }
    session.value = null;
    CLEAN_STAGE();
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

  function removeChat(messageId: string) {
    mqtt.sendMessage(TOPICS.CHAT, { remove: messageId });
  }

  function highlightChat(messageId: string) {
    mqtt.sendMessage(TOPICS.CHAT, { highlight: messageId });
  }

  /**
   * Set the player-chat panel visibility. Renamed from the bare
   * `showPlayerChat(visible)` action — the state ref of the same name
   * already occupies the return-object key (see file-header
   * name-collision note).
   */
  function setShowPlayerChat(visible: boolean) {
    SET_SHOW_PLAYER_CHAT(visible);
    if (visible) {
      SEEN_PRIVATE_MESSAGES();
    }
  }

  function autoFocusMoveable(id: ObjectId | null) {
    if (canPlay.value && !preferences.value.isDrawing && !replay.value.isReplaying) {
      SET_ACTIVE_MOVABLE(id);
    }
  }

  function handleDrawMessage({ message }: { message: DrawMessage }) {
    UPDATE_WHITEBOARD(message);
  }

  function sendDrawWhiteboard(command: WhiteboardCommand) {
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

  function openPurchasePopup(setting: PurchasePopup) {
    setting.isActive = true;
    SET_PURCHASE_POPUP(setting);
  }

  function openReceiptPopup(setting?: unknown) {
    OPEN_RECEIPT_POPUP(setting);
  }

  function closeReceiptPopup() {
    CLOSE_RECEIPT_POPUP();
  }

  function addTrack(track: JitsiTrack) {
    ADD_TRACK(track);
  }

  /**
   * Trigger a stream-reload tick. Renamed from the bare
   * `reloadStreams()` action — the computed getter of the same name
   * already occupies the return-object key (see file-header
   * name-collision note).
   */
  function triggerReloadStreams() {
    RELOAD_STREAMS();
  }

  // ====================================================================
  // RETURN — public store surface
  // ====================================================================

  return {
    // state (raw refs)
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
    // getters (computed views)
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
    // mutations (UPPER_SNAKE_CASE)
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
    REORDER_TOOLBOX,
    SET_PURCHASE_POPUP,
    ADD_TRACK,
    RELOAD_STREAMS,
    OPEN_RECEIPT_POPUP,
    CLOSE_RECEIPT_POPUP,
    // actions (lowerCamelCase; the `setShowPlayerChat` and
    // `triggerReloadStreams` renames are documented in the file header).
    connect,
    subscribe,
    disconnect,
    disconnectSync,
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
    toggleCurtainAutoplay,
    setCurtainSpeed,
    setCurtainDwell,
    setCurtainFrame,
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
