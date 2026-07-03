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
  isHoldableBoardObject,
  isJitsiBoardType,
  isStreamPlaybackBoardType,
  posterJpgForVideoUrl,
  randomColor,
  randomMessageColor,
  randomRange,
} from "@utils/common";
import { BACKGROUND_ACTIONS, BOARD_ACTIONS, COLORS, DRAW_ACTIONS, TOPICS } from "@utils/constants";
import { loadReplayMarkers } from "@utils/replayMarkers";
import {
  deserializeObject,
  getDefaultStageConfig,
  getDefaultStageSettings,
  recalcFontSize,
  serializeForBroadcast,
  serializeObject,
} from "@stores/modules/stage/reusable";
import { unnamespaceTopic } from "@utils/mqttTopics";
import { computeFinalJitsiObjectsFromEvents } from "@utils/jitsiBoardReconcile";
import { useAttribute } from "@services/graphql/composable";
import { avatarSpeak, stopSpeaking } from "@services/speech";
import { useAuthStore } from "@stores/pinia/auth";
import { useUserStore } from "@stores/pinia/user";

/** Skip anime when the selector is not in DOM (e.g. MQTT before live Layout mounts #board). */
function animateIfPresent(selector: string, options: Parameters<typeof animate>[1]) {
  const node = document.querySelector(selector);
  if (node) {
    animate(node as HTMLElement, options);
  }
}

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
  /** When false, multiframe `autoplayFrames` stops after one cycle; true/omitted = loop. */
  frameLoop?: boolean;
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
  /** When false, playback stops after one full pass; when true/omitted, loops (legacy). */
  frameLoop?: boolean;
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
  /** Same semantics as `Background.frameLoop` for multi-frame curtains. */
  frameLoop?: boolean;
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
  chats?: { payload: ChatMessage | string; performanceId?: string | number }[];
  activeRecording?: { id: string | number; name?: string; createdOn?: string } | null;
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
  // lib-jitsi-meet methods we invoke from typed code. Declaring them here
  // keeps the rest of the interface loose while letting TS resolve call
  // signatures; without this, `track.getId?.()` narrows to `{}` and fails
  // to typecheck.
  getId?: () => string | number | undefined;
  getParticipantId?: () => string | undefined;
  [k: string]: unknown;
}

export interface Session {
  id: string;
  isPlayer?: boolean;
  nickname?: string;
  at: number;
  avatarId?: ObjectId | null;
  /** Logged-in performer's user id; distinct from `id` (per-tab session). */
  userId?: string | number | null;
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
  videos: ToolboxItem[];
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

export interface ReplayMarker {
  id: string;
  label: string;
  mqttTimestamp: number;
}

export interface ReplayState {
  timestamp: { begin: number; end: number; current: number };
  timers: ReturnType<typeof setTimeout>[];
  interval: ReturnType<typeof setInterval> | null;
  speed: number;
  isReplaying?: boolean;
  /** Restart from `begin` when playback passes `end` (exhibition loop). */
  loop?: boolean;
  performanceId?: string | null;
  markers?: ReplayMarker[];
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

/**
 * Per-tab stage session id. Stored in `sessionStorage` so refreshes
 * inside the same tab keep the same id (no stale "viewer" left behind
 * in other clients' sessions lists for ~60 minutes) but new tabs and
 * second logins on the same account each get a distinct id.
 *
 * sessionStorage is intentional: localStorage would be shared across
 * tabs and reintroduce the cross-contamination bug we're solving.
 */
const TAB_SESSION_ID_KEY = "upstage:stage:tabSessionId";
function readOrMintTabSessionId(): string {
  try {
    const ss = window.sessionStorage;
    const existing = ss.getItem(TAB_SESSION_ID_KEY);
    if (existing) return existing;
    const fresh = uuidv4();
    ss.setItem(TAB_SESSION_ID_KEY, fresh);
    return fresh;
  } catch {
    // sessionStorage can throw in private-mode / iframes with cookies
    // disabled. Fall back to an in-memory uuid — same-tab refresh will
    // mint a new id, which matches the pre-fix behaviour for anon
    // viewers and is strictly safer than colliding ids.
    return uuidv4();
  }
}

export const useStageStore = defineStore(
  "stage",
  () => {
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

    /** Set when lib-jitsi-meet reports CONFERENCE_JOINED; used to fill jitsi board objects dragged before myUserId existed. */
    const localJitsiParticipantId = ref<string | null>(null);
    /** Jitsi tile ids waiting for CONFERENCE_JOINED before first MQTT PLACE. */
    const pendingJitsiPublish = new Set<ObjectId>();

    const tools = ref<ToolsState>({
      avatars: [],
      props: [],
      backdrops: [],
      audios: [],
      videos: [],
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
    // Static placeholder; `useStageViewport()` (composables/useStageViewport.ts)
    // starts mutating this once App.vue mounts. TDZ caveat: do not call
    // `getViewport()` here — the helper depends on `window.innerWidth`
    // which is `0` during SSR / pre-mount Vite startup.
    const viewport = ref<Viewport>({ width: 0, height: 0 });
    const sessions = ref<Session[]>([]);
    const session = ref<string | null>(null);
    // Publisher-side aggregation of viewer freeze reports (TOPICS.STREAM_HEALTH).
    // Keyed `${viewerSession}:${objectId}` → last-seen timestamp (ms). Only
    // reports addressed to OUR session (`message.hostId === session`) are kept.
    // Pruned on a timer (ageout + roster departure) so the count self-corrects.
    const frozenViewerReports = ref<Map<string, number>>(new Map());
    const FROZEN_REPORT_TTL_MS = 10_000;
    const REPLAY_LOOP_KEY = "upstage-replay-loop";
    const replay = ref<ReplayState>({
      timestamp: { begin: 0, end: 0, current: 0 },
      timers: [],
      interval: null,
      speed: 1,
      loop: false,
      performanceId: null,
      markers: [],
    });
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem(REPLAY_LOOP_KEY) === "true") {
        replay.value.loop = true;
      }
    } catch {
      /* private mode / blocked storage */
    }
    const audioPlayers = ref<AudioPlayer[]>([]);
    // Global "master" level applied on top of each track's own volume by
    // AudioPlayer.vue. `masterAudioSignal` is replaced (not mutated) on every
    // change so AudioPlayer re-applies even when the value repeats; it carries
    // the fade `duration` so every client animates over the same span.
    const masterAudioVolume = ref<number>(1);
    const masterAudioSignal = ref<{ volume: number; duration: number; seq: number }>({
      volume: 1,
      duration: 0,
      seq: 0,
    });
    const isSavingScene = ref<boolean>(false);
    const isLoadingScenes = ref<boolean>(false);
    const showPlayerChat = ref<boolean>(false);
    const showClearChatSetting = ref<boolean>(false);
    const showDownloadChatSetting = ref<boolean>(false);
    // Per-session palette layout for logged-in players. Both are
    // intentionally not persisted to MQTT / localStorage / server: each
    // player customizes their own UI within a single stage session, and
    // CLEAN_STAGE below resets them on stage re-entry to match Vicki's
    // "restore to default at each stage re-entry" expectation. `null`
    // position means "use the component's CSS-default layout"; a
    // concrete {x,y} overrides it.
    const topbarPosition = ref<{ x: number; y: number } | null>(null);
    const topbarCollapsed = ref<boolean>(false);
    const publicChatPosition = ref<{ x: number; y: number } | null>(null);
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
    // Separate, additive signal for an EXPLICIT user-initiated "Refresh
    // streams" click (vs. the gentle `_reloadStreams` fired on automatic
    // page-wake). Only the force signal is allowed to bypass the publisher
    // storm-guard and the viewer idempotent-attach flicker-guard, so a stuck
    // (frozen but not disconnected) stream can actually be re-established
    // without reintroducing the Brave publish-storm / whole-board flicker
    // those guards were added to fix.
    const _forceReloadStreams = ref<Date | null>(null);
    /** Bumped by `refreshMeeting()` to remount embedded conference iframes. */
    const _meetingRefreshKey = ref(0);
    const _enabledLiveStreaming = ref<boolean>(true);
    /**
     * Standalone `/chat/:url` connects to the same MQTT stream as the live
     * stage but renders only chat — avatar meSpeak would otherwise play on
     * each audience device (e.g. many phones in a hybrid room).
     */
    const suppressAvatarSpeechOutput = ref(false);

    // ====================================================================
    // GETTERS
    // ====================================================================

    // ready: model loaded and preload finished
    const ready = computed(() => model.value && !preloading.value);

    const url = computed(() => (model.value ? model.value.fileLocation : "demo"));

    const objects = computed(() =>
      board.value.objects.map((o) => ({
        ...o,
        holder: sessions.value.find(
          (s) => s.isPlayer && s.avatarId != null && s.avatarId !== "" && s.avatarId === o.id,
        ),
      })),
    );

    /**
     * Participant ids that currently have media on the board — i.e. a jitsi
     * tile for one of these ids actually renders (it is NOT a track-less
     * ghost). Mirrors what `Jitsi.vue` needs to show video/audio:
     *   - every participant id present on a `board.value.tracks` entry, plus
     *   - the local participant when an *ownerless* track exists (a local
     *     track added before lib-jitsi-meet assigned its participantId — see
     *     ADD_TRACK), so the performer's own live tile still counts as live.
     *
     * Consumed by the Depth toolbar to hide stale, unbindable jitsi tiles from
     * the list WITHOUT deleting the board object. Deletion is unsafe here: a
     * performer may legitimately publish several concurrent stream tiles from
     * one tab (see utils/jitsiBoardReconcile.ts), and a stale ghost is
     * observationally identical to one of those in live state. Filtering the
     * display is reversible — the tile reappears the moment it has media.
     */
    const liveJitsiParticipantIds = computed(() => {
      const ids = new Set<string>();
      let hasOwnerlessTrack = false;
      for (const t of board.value.tracks) {
        const pid = t.getParticipantId?.();
        if (pid != null && pid !== "") ids.add(String(pid));
        else hasOwnerlessTrack = true;
      }
      if (hasOwnerlessTrack && localJitsiParticipantId.value != null) {
        ids.add(String(localJitsiParticipantId.value));
      }
      return ids;
    });

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
      assets.push(
        ...tools.value.videos
          .filter((v): v is typeof v & { url: string } => Boolean(v.url))
          .map((v) => posterJpgForVideoUrl(v.url)),
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

    // Number of DISTINCT viewer sessions currently reporting at least one of
    // our streams as frozen (drives the "Frozen for N viewers" badge). Reads
    // the map reactively; stale entries are removed by the pruner, but we also
    // apply the TTL here so a paused pruner can never over-count.
    const frozenViewerCount = computed(() => {
      const now = +new Date();
      const viewers = new Set<string>();
      for (const [key, at] of frozenViewerReports.value) {
        if (now - at > FROZEN_REPORT_TTL_MS) continue;
        const viewerSession = key.slice(0, key.lastIndexOf(":"));
        if (viewerSession) viewers.add(viewerSession);
      }
      return viewers.size;
    });

    const unreadPrivateMessageCount = computed(
      () =>
        chat.value.privateMessages.filter((m) => (m.at ?? 0) > lastSeenPrivateMessage.value).length,
    );

    const whiteboard = computed(() => board.value.whiteboard);

    const jitsiTracks = computed(() => board.value.tracks);

    const reloadStreams = computed(() => _reloadStreams.value);
    const forceReloadStreams = computed(() => _forceReloadStreams.value);
    const meetingRefreshKey = computed(() => _meetingRefreshKey.value);

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

    /**
     * Map a stage asset GraphQL/library row into an internal toolbox bucket
     * (singular: avatar, prop, backdrop, …). Streams/index.vue (and MQTT
     * board code) expects `tools.videos` for every stream / VoD strip the
     * author assigned to the stage.
     *
     * We accept several synonyms for "video" (some backends and older
     * rows used `stream` / `streaming`, or lacked `assetType` while exposing
     * only a playable URL in `src` / `fileLocation`).
     */
    function resolveToolboxBucketName(item: ToolboxItem): string {
      const nested =
        item.assetType && typeof item.assetType === "object" && "name" in item.assetType
          ? String((item.assetType as { name?: string }).name ?? "")
          : "";
      const flatType = typeof item.assetType === "string" ? item.assetType : "";
      let base = (nested || flatType || (typeof item.type === "string" ? item.type : "")).trim();
      base = base.toLowerCase();

      const videoAliases = new Set(["video", "stream", "streams", "streaming"]);
      if (videoAliases.has(base)) {
        base = "video";
      }

      if (!base) {
        const hint = `${item.fileLocation ?? ""} ${item.src ?? ""}`.toLowerCase();
        if (/\.(mp4|webm|ogg|mov)(\?|#|$)/i.test(hint)) {
          base = "video";
        }
      }

      return base;
    }

    function SET_MODEL(newModel: StageModel | null) {
      model.value = newModel;
      if (newModel) {
        const media = newModel.assets;
        if (media && media.length) {
          media.forEach((item) => {
            const assetName = resolveToolboxBucketName(item);
            // Streams/index.vue expects `stageStore.tools.videos`. GraphQL sometimes
            // returns capitalised asset type labels ("Video"); without normalising we
            // populated `Videos` instead and the palette rendered empty (see Streams tool).
            if (assetName) {
              item.type = assetName;
            }
            if (assetName === "video") {
              const loc = (item.fileLocation ?? item.src ?? "") as string;
              item.url = absolutePath(loc);
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
            const key = assetName ? `${assetName}s` : "";
            if (!key) {
              return;
            }
            if (!tools.value[key]) {
              tools.value[key] = [];
            }
            tools.value[key].push(item);
          });
          // Give the asset palettes a stable alphabetical default order instead
          // of raw GraphQL/DB order, so an author can find e.g. an avatar by
          // name. This runs once at load; in-session drag reordering
          // (REORDER_TOOLBOX) still applies on top and is not persisted, so
          // nothing the user arranged is lost by sorting here. Scenes
          // (scene_order), meetings (FIFO) and audio/video strips keep their
          // own meaningful ordering and are intentionally excluded.
          (["avatars", "props", "backdrops", "curtains"] as const).forEach((paletteKey) => {
            tools.value[paletteKey]?.sort((a, b) =>
              String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, {
                sensitivity: "base",
              }),
            );
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
      // Always tear down replay timers/interval first — otherwise navigating away
      // from `/replay/...` (or calling CLEAN_STAGE while a replay was active) leaves
      // zombie setInterval/setTimeout handlers that keep firing replayEvent (audio,
      // board updates) after the UI unmounts.
      pauseReplay();
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
      tools.value.videos = [];
      tools.value.curtains = [];
      _config.value = getDefaultStageConfig() as StageConfig;
      settings.value = getDefaultStageSettings() as StageSettings;
      board.value.objects = [];
      board.value.tracks = [];
      board.value.drawings = [];
      board.value.texts = [];
      board.value.whiteboard = [];
      chat.value.messages = [];
      chat.value.privateMessages = [];
      chat.value.color = randomColor();
      topbarPosition.value = null;
      topbarCollapsed.value = false;
      publicChatPosition.value = null;
      localJitsiParticipantId.value = null;
      pendingJitsiPublish.clear();
      // Masquerading is a player-only "preview as audience" affordance.
      // If we leave it true across CLEAN_STAGE, a player who navigates
      // away mid-masquerade and returns to a stage would be silently
      // stuck in audience view (canPlay=false → no toolbox, no player
      // chat) until they hunt the toggle down again. Reset it here so
      // re-entry always starts in player mode for users with the
      // permission.
      masquerading.value = false;
    }

    function SET_BACKGROUND(bg: Background | null) {
      if (bg) {
        if (
          !background.value ||
          !background.value.at ||
          (background.value.at ?? 0) < (bg.at ?? 0)
        ) {
          if (!background.value || background.value.id !== bg.id) {
            // Not playing animation if only opacity change
            animateIfPresent("#board", { opacity: [0, 1], duration: 5000 });
          }
          background.value = bg;
        }
      }
    }

    function SET_STATUS(newStatus: string) {
      status.value = newStatus;
    }

    function refreshLiveStatus() {
      // loadStage() flips status to OFFLINE via CLEAN_STAGE even when the broker
      // socket never dropped (e.g. reloading the model after a recording
      // mutation). If the socket is still connected we are still LIVE — restore
      // it now instead of waiting for an unrelated reconnect to re-fire mqtt's
      // `connect` event.
      // `src/services/mqtt.ts` is @ts-nocheck and infers `.client = null`, so
      // assert the connected flag we read here (mqtt.js exposes it at runtime).
      if ((mqtt.client as { connected?: boolean } | null)?.connected) {
        SET_STATUS("LIVE");
      }
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
      if (isJitsiBoardType(object.type) && object.participantId) {
        pruneJitsiTracksForParticipant(String(object.participantId));
      }
      reconcileAvatarHolds();
    }

    /** Drop WebRTC tracks when no on-stage tile still references the participant. */
    function pruneJitsiTracksForParticipant(participantId: string) {
      const stillOnBoard = board.value.objects.some(
        (o) => isJitsiBoardType(o.type) && o.participantId === participantId,
      );
      if (stillOnBoard) return;
      board.value.tracks = board.value.tracks.filter(
        (t) => t.getParticipantId?.() !== participantId,
      );
    }

    function REMOVE_TRACK(track: JitsiTrack) {
      const id = track.getId?.();
      board.value.tracks = board.value.tracks.filter((t) => {
        if (id !== undefined) return t.getId?.() !== id;
        return t !== track;
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
          if (
            !mute &&
            (status.value === "LIVE" || replay.value.isReplaying) &&
            !suppressAvatarSpeechOutput.value
          ) {
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

    /** Reconcile `board.objects` paint order with the performer's stack index. */
    function setObjectStackIndex(objectId: ObjectId, targetIndex: number) {
      const current = board.value.objects.findIndex((o) => o.id === objectId);
      if (current < 0) return;
      const [obj] = board.value.objects.splice(current, 1);
      const idx = Math.max(0, Math.min(targetIndex, board.value.objects.length));
      board.value.objects.splice(idx, 0, obj);
    }

    function boardStackIndexFor(objectId: ObjectId): number {
      return board.value.objects.findIndex((o) => o.id === objectId);
    }

    /** True when audience should receive a board side-effect (not local-only ghosts). */
    function shouldSyncBoardMutationToAudience(object: BoardObject): boolean {
      return Boolean(object.liveAction || object.published);
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
      const beforeLen = sessions.value.length;
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
          // Explicit null/undefined in the payload means "no avatar held".
          // Object.assign alone cannot clear a field when the key is
          // omitted from the wire message, so we only force-clear when
          // the publisher included avatarId (joinStage always does).
          if ("avatarId" in s && (s.avatarId === null || s.avatarId === undefined)) {
            sessions.value[index].avatarId = null;
          }
          // Audience sessions must never carry a hold.
          if (!sessions.value[index].isPlayer) {
            sessions.value[index].avatarId = null;
          }
        }
      } else {
        sessions.value.push(s);
      }
      sessions.value = sessions.value.filter(
        (x) => dayjs().diff(dayjs(new Date(x.at)), "minute") < 60,
      );
      sessions.value.sort((a, b) => b.at - a.at);
      reconcileAvatarHolds();
      if (canPlay.value) {
        pruneOrphanJitsiTilesFromOldSessions();
      }
      if (subscribeSuccess.value && sessions.value.length !== beforeLen) {
        void sendStatistics();
      }
    }

    /**
     * Keep this tab's row in `sessions` aligned with `userStore.avatarId`.
     * The teardrop reads `object.holder` from sessions, not from the user
     * store — if we clear `userStore.avatarId` on release but the local
     * session row still lists an `avatarId`, the red teardrop stays up even
     * though the performer has let go.
     */
    function syncLocalSessionAvatarHold() {
      const sid = session.value;
      if (sid == null || !canPlay.value) return;
      const userStore = useUserStore();
      const desired = userStore.avatarId ?? null;
      const index = sessions.value.findIndex(
        (x) => (x.id != null ? String(x.id) : x.id) === String(sid),
      );
      if (index < 0) return;
      if (sessions.value[index].avatarId !== desired) {
        sessions.value[index].avatarId = desired;
      }
    }

    /**
     * One avatar → one player session; one session → one avatar; one logged-in
     * user (`userId`) → one holding tab across browsers. Clears duplicate/stale
     * holds and syncs local `userStore.avatarId` when this tab lost the claim.
     */
    function reconcileAvatarHolds() {
      syncLocalSessionAvatarHold();
      const objectIds = new Set(board.value.objects.map((o) => o.id));
      for (const s of sessions.value) {
        if (s.avatarId != null && s.avatarId !== "" && !objectIds.has(s.avatarId)) {
          s.avatarId = null;
        }
      }

      const winnerByAvatar = new Map<ObjectId, Session>();
      for (const s of sessions.value) {
        if (!s.isPlayer || s.avatarId == null || s.avatarId === "") {
          if (s.avatarId != null && s.avatarId !== "" && !s.isPlayer) {
            s.avatarId = null;
          }
          continue;
        }
        const prev = winnerByAvatar.get(s.avatarId);
        if (!prev || s.at >= prev.at) {
          if (prev) prev.avatarId = null;
          winnerByAvatar.set(s.avatarId, s);
        } else {
          s.avatarId = null;
        }
      }

      // Same account in multiple tabs: only the newest player session (by `at`)
      // may hold any avatar. Without this, two tabs could each hold a different
      // avatar and both show a red teardrop for one human.
      const winnerByUserId = new Map<string, Session>();
      for (const s of sessions.value) {
        if (!s.isPlayer || s.avatarId == null || s.avatarId === "") continue;
        const uid = s.userId;
        if (uid == null || uid === "") continue;
        const key = String(uid);
        const prev = winnerByUserId.get(key);
        if (!prev || s.at >= prev.at) {
          if (prev) prev.avatarId = null;
          winnerByUserId.set(key, s);
        } else {
          s.avatarId = null;
        }
      }

      const userStore = useUserStore();
      const sid = session.value;
      if (sid != null && userStore.avatarId != null) {
        const stillHeld = sessions.value.some(
          (s) => s.isPlayer && String(s.id) === String(sid) && s.avatarId === userStore.avatarId,
        );
        if (!stillHeld) {
          userStore.$patch({ avatarId: null });
          SET_ACTIVE_MOVABLE(null);
          if (canPlay.value) {
            void publishSessionCounter(buildSessionCounterPayload({ avatarId: null }));
          }
        }
      }
      syncLocalSessionAvatarHold();
    }

    function buildSessionCounterPayload(overrides: Partial<Session> = {}): Session {
      const userStore = useUserStore();
      const isPlayer = Boolean(canPlay.value);
      const id = session.value!;
      const payload = {
        at: +new Date(),
        nickname: userStore.nickname,
        avatarId: isPlayer ? (userStore.avatarId ?? null) : null,
        userId: isPlayer ? (userStore.currentUserId ?? null) : null,
        isPlayer,
        ...overrides,
        id,
      } as Session;
      if (overrides.isPlayer === undefined) {
        payload.isPlayer = isPlayer;
      }
      return payload;
    }

    function publishSessionCounter(payload: Session, sync = false) {
      UPDATE_SESSIONS_COUNTER(payload);
      if (sync) {
        mqtt.sendMessageSync(TOPICS.COUNTER, payload);
      } else {
        void mqtt.sendMessage(TOPICS.COUNTER, payload);
      }
    }

    /**
     * Release the avatar this tab is holding: clear user store, local session
     * row, and broadcast `avatarId: null` so teardrops drop everywhere.
     */
    function releaseAvatarHold(sync = false) {
      if (!canPlay.value || session.value == null) return;
      const userStore = useUserStore();
      if (userStore.avatarId == null) {
        syncLocalSessionAvatarHold();
        return;
      }
      userStore.$patch({ avatarId: null });
      SET_ACTIVE_MOVABLE(null);
      syncLocalSessionAvatarHold();
      publishSessionCounter(buildSessionCounterPayload({ avatarId: null }), sync);
    }

    /** Drop avatar hold on peers before leave so teardrops cannot orphan. */
    function releaseAvatarBeforeLeave(sync: boolean) {
      releaseAvatarHold(sync);
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
      if ("loop" in r) {
        try {
          localStorage.setItem(REPLAY_LOOP_KEY, r.loop ? "true" : "false");
        } catch {
          /* ignore */
        }
      }
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
      animateIfPresent("#live-stage", {
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
          // Reconcile the audio library IN PLACE — never swap the array.
          // AudioPlayer.vue captures `tools.audios` once at mount; its <audio>
          // elements and `refs[]` are keyed to that array by index, so a
          // wholesale reassignment detaches playback control — stale tracks
          // keep playing and the new scene's state never reaches the elements.
          // Matching incoming tracks by `src`, we restore each saved track's
          // state and, crucially, STOP any track the new scene does not play
          // (the bug: tracks absent from the scene got no stop message). The
          // `changed`/`saken` flags drive AudioPlayer's watcher to
          // play/pause/seek each element, on every client (this handler runs
          // on the initiator and the audience alike).
          const incoming = snapshot.audios;
          const incomingPlayers = snapshot.audioPlayers ?? [];
          tools.value.audios.forEach((track) => {
            const idx = incoming.findIndex((a) => a.src === track.src);
            const next = idx >= 0 ? incoming[idx] : undefined;
            track.isPlaying = next?.isPlaying ?? false;
            track.currentTime = incomingPlayers[idx]?.currentTime ?? next?.currentTime ?? 0;
            if (next?.volume !== undefined) track.volume = next.volume;
            if (next?.loop !== undefined) track.loop = next.loop;
            track.saken = true;
            track.changed = true;
          });
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
        const tn = String(from.type ?? "").toLowerCase();
        const toolName = tn ? `${tn}s` : "";
        if (toolName && tools.value[toolName]) {
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

    function FORCE_RELOAD_STREAMS() {
      _forceReloadStreams.value = new Date();
    }

    function REFRESH_MEETING() {
      _meetingRefreshKey.value += 1;
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

    // Presence heartbeat: re-publishes the local session on TOPICS.COUNTER
    // every 5 minutes so other clients' UPDATE_SESSIONS_COUNTER 60-min trim
    // never reaches the row. Without this, a quiet performer silently
    // disappears from every other client's player list while remaining
    // fully connected to MQTT/chat (the bug Vicki hit during the walkthrough).
    // Single-slot interval; startHeartbeat() is idempotent.
    const HEARTBEAT_MS = 5 * 60 * 1000;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    function startHeartbeat() {
      if (heartbeatInterval !== null) return;
      heartbeatInterval = setInterval(() => {
        if (session.value) {
          void joinStage();
        }
      }, HEARTBEAT_MS);
    }

    function stopHeartbeat() {
      if (heartbeatInterval !== null) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    }

    // Prune viewer freeze reports so the "Frozen for N viewers" count can never
    // stick: drop entries older than the TTL (a viewer that crashed / lost its
    // recovery message stops sending heartbeats) or whose viewer session has
    // left the roster. Runs while connected; idempotent to (re)arm.
    const FROZEN_PRUNE_INTERVAL_MS = 5_000;
    let frozenPruneInterval: ReturnType<typeof setInterval> | null = null;

    function pruneFrozenViewerReports() {
      if (frozenViewerReports.value.size === 0) return;
      const now = +new Date();
      const liveSessions = new Set(sessions.value.map((s) => String(s.id)));
      let changed = false;
      const next = new Map(frozenViewerReports.value);
      for (const [key, at] of next) {
        const viewerSession = key.slice(0, key.lastIndexOf(":"));
        if (now - at > FROZEN_REPORT_TTL_MS || !liveSessions.has(viewerSession)) {
          next.delete(key);
          changed = true;
        }
      }
      if (changed) frozenViewerReports.value = next;
    }

    function startFrozenViewerPruner() {
      if (frozenPruneInterval !== null) return;
      frozenPruneInterval = setInterval(pruneFrozenViewerReports, FROZEN_PRUNE_INTERVAL_MS);
    }

    function stopFrozenViewerPruner() {
      if (frozenPruneInterval !== null) {
        clearInterval(frozenPruneInterval);
        frozenPruneInterval = null;
      }
      frozenViewerReports.value = new Map();
    }

    function connect() {
      SET_STATUS("CONNECTING");
      const client = mqtt.connect() as MqttClient | null;
      if (!client) return;
      client.on("connect", () => {
        SET_STATUS("LIVE");
        void reloadMissingEvents();
        subscribe();
        // Hydrate the current user before announcing presence so the
        // first joinStage() publishes the resolved nickname / isPlayer
        // flag rather than a guest placeholder. The session id itself is
        // a per-tab uuid (see readOrMintTabSessionId), independent of
        // user.id, so this is just about the rest of the payload.
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
          // Arm the presence heartbeat AFTER the first joinStage so we never
          // race a heartbeat publish against the initial join. mqtt.js auto-
          // reconnects fire 'connect' again, so re-arming here is also the
          // re-arm path post-disconnect — startHeartbeat is idempotent.
          startHeartbeat();
          startFrozenViewerPruner();
        })();
      });
      client.on("error", (err) => {
        console.error("[MQTT] Stage client error:", err?.message ?? err);
        SET_STATUS("OFFLINE");
        stopHeartbeat();
      });
      client.on("reconnect", () => SET_STATUS("CONNECTING"));
      client.on("close", () => {
        SET_STATUS("OFFLINE");
        stopHeartbeat();
      });
      client.on("disconnect", () => {
        SET_STATUS("OFFLINE");
        stopHeartbeat();
      });
      client.on("offline", () => {
        SET_STATUS("OFFLINE");
        stopHeartbeat();
      });
      mqtt.receiveMessage((payload: { topic: string; message: unknown }) => handleMessage(payload));
    }

    function subscribe() {
      const topics = {
        [TOPICS.CHAT]: { qos: 2 },
        [TOPICS.BOARD]: { qos: 2 },
        [TOPICS.BACKGROUND]: { qos: 2 },
        [TOPICS.AUDIO]: { qos: 2 },
        [TOPICS.AUDIO_MASTER]: { qos: 2 },
        [TOPICS.REACTION]: { qos: 2 },
        [TOPICS.COUNTER]: { qos: 2 },
        [TOPICS.DRAW]: { qos: 2 },
        [TOPICS.STREAM_HEALTH]: { qos: 1 },
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
      stopHeartbeat();
      stopFrozenViewerPruner();
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

    /** Viewer → performer freeze report on TOPICS.STREAM_HEALTH. */
    interface StreamHealthMessage {
      /** Publisher session id the report is addressed to. */
      hostId?: string | null;
      /** Board object id of the frozen tile. */
      objectId?: string | number | null;
      participantId?: string | null;
      /** Reporting viewer's per-tab session id. */
      viewerSession?: string | null;
      frozen?: boolean;
      at?: number;
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
        case TOPICS.AUDIO_MASTER:
          handleAudioMasterMessage({ message: message as { volume?: number; duration?: number } });
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
        case TOPICS.STREAM_HEALTH:
          handleStreamHealthMessage({ message: message as StreamHealthMessage });
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
      const inheritedTypeLabel = `${data.assetType?.name ?? data.type ?? ""}`.trim();
      const resolvedBoardType = isStreamPlaybackBoardType(inheritedTypeLabel)
        ? "video"
        : isJitsiBoardType(inheritedTypeLabel)
          ? "jitsi"
          : inheritedTypeLabel || data.type;

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
        // Prefer GraphQL assetType.name (legacy) OR flat type but fold
        // case/synonyms so Streams strip items never land as `"Video"` on
        // board (which skipped Object.vue's <video slot and showed a
        // broken <AppImage>: streams use `url`, not `src`).
        // Same fold for `Jitsi` → `jitsi` so Board.vue's TYPE_TO_COMPONENT
        // lookup resolves to Jitsi.vue (keys are lowercase).
        type: resolvedBoardType,
      };
      const inferredJitsiId = localJitsiParticipantId.value;
      if (
        isJitsiBoardType(object.type) &&
        (object.participantId == null || object.participantId === "") &&
        inferredJitsiId
      ) {
        object.participantId = inferredJitsiId;
      }
      // Stamp the placing-tab's session id on jitsi tiles so we can heal
      // their stale `participantId` after a navigate-away/back. lib-jitsi-
      // meet assigns a fresh `myUserId` on every CONFERENCE_JOINED, so a
      // persisted tile that was published as participant `abc123` is
      // orphaned the next time the same performer rejoins as `xyz789`.
      // `session.value` is per-tab and survives in sessionStorage across
      // intra-tab navigation, so it's the right key for "this tile is
      // mine" — `syncLocalJitsiParticipantId` uses it to re-bind on the
      // next join.
      if (isJitsiBoardType(object.type) && session.value) {
        object.hostId = session.value;
      }
      // Stream tiles placed WITHOUT explicit coordinates (programmatic / future
      // flows) all default to the origin and would stack invisibly on top of
      // each other. Cascade each additional own jitsi tile by a small offset so
      // concurrent streams are visibly distinct. The normal drag-from-preview
      // path supplies real drop coordinates (Board.vue) and is left untouched.
      if (isJitsiBoardType(object.type) && data.x == null && data.y == null) {
        const ownJitsiCount = board.value.objects.filter(
          (o) =>
            isJitsiBoardType(o.type) &&
            ((session.value != null && o.hostId === session.value) ||
              (localJitsiParticipantId.value != null &&
                o.participantId === localJitsiParticipantId.value)),
        ).length;
        if (ownJitsiCount > 0) {
          const STREAM_CASCADE_PX = 30;
          object.x = ownJitsiCount * STREAM_CASCADE_PX;
          object.y = ownJitsiCount * STREAM_CASCADE_PX;
        }
      }
      if (isStreamPlaybackBoardType(object.type)) {
        object.hostId = session.value;
        // Never auto-play a freshly placed video. Placement starts paused so
        // the performer can size/position it and light the bulb first; the
        // ONLY thing that starts playback is the object's own Play tool
        // (ContextMenuAvatar.vue playVideo). Forcing `false` (rather than
        // defaulting undefined -> true as before) also guards against a
        // stale `isPlaying` riding in on the drag payload: with a truthy
        // value in the store, ANY later board update (e.g. dropping a
        // meeting or stream tile) re-runs Object.vue's synchronize() inside
        // a fresh user gesture and a previously blocked play() suddenly
        // succeeds — an unlit video would appear to start on its own.
        object.isPlaying = false;
        try {
          const description = JSON.parse(data.description ?? "");
          if (description.w && description.h) object.h = (description.h * 100) / description.w;
        } catch {
          // description is optional / may not be JSON; fall back to defaults.
        }
      }
      PUSH_OBJECT(serializeObject(object));
      // Case-insensitive avatar check: GraphQL `assetType.name` can arrive as
      // "Avatar", so an exact `=== "avatar"` would occasionally skip the claim
      // and the dropped avatar would get no teardrop. `isHoldableBoardObject`
      // is avatar-only now (streams are props) and folds case.
      if (isHoldableBoardObject(object) && canPlay.value) {
        useUserStore().setAvatarId(object.id);
        SET_ACTIVE_MOVABLE(null);
      }
      return object;
    }

    /** MQTT board tracing for individual Jitsi stream tiles (not video bytes). */
    function diagMqttJitsiBoard(
      direction: "out" | "in",
      action: string,
      object?: BoardObject,
      extra?: Record<string, unknown>,
    ) {
      if (!object || !isJitsiBoardType(object.type)) return;
      console.log(`[diag] mqtt board ${direction}`, {
        action,
        objectId: object.id,
        participantId: object.participantId,
        type: object.type,
        liveAction: object.liveAction,
        published: object.published,
        ...extra,
      });
    }

    function jitsiParticipantIdMissing(object: BoardObject): boolean {
      return object.participantId == null || object.participantId === "";
    }

    function stampJitsiParticipantId(object: BoardObject): BoardObject {
      if (!isJitsiBoardType(object.type) || !jitsiParticipantIdMissing(object)) {
        return object;
      }
      const inferred = localJitsiParticipantId.value;
      if (!inferred) return object;
      return { ...object, participantId: inferred };
    }

    /** Push jitsi tile metadata to audience when participantId is known. */
    function mqttBroadcastJitsiTile(object: BoardObject, note?: string) {
      if (!canPlay.value || !isJitsiBoardType(object.type) || jitsiParticipantIdMissing(object)) {
        return;
      }
      if (object.published) {
        diagMqttJitsiBoard("out", BOARD_ACTIONS.MOVE_TO, object, note ? { note } : undefined);
        mqtt.sendMessage(TOPICS.BOARD, {
          type: BOARD_ACTIONS.MOVE_TO,
          object: serializeForBroadcast(object),
          zIndex: boardStackIndexFor(object.id),
        });
        return;
      }
      const payload = {
        ...object,
        published: true,
        displayName: object.displayName ?? useUserStore().nickname ?? "",
      } as BoardObject;
      UPDATE_OBJECT(serializeObject(payload));
      diagMqttJitsiBoard(
        "out",
        BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE,
        payload,
        note ? { note } : undefined,
      );
      mqtt.sendMessage(TOPICS.BOARD, {
        type: BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE,
        object: serializeForBroadcast(payload),
      });
    }

    function flushPendingJitsiPublish(participantId: string) {
      const ids = [...pendingJitsiPublish];
      pendingJitsiPublish.clear();
      for (const objectId of ids) {
        const o = board.value.objects.find((obj) => obj.id === objectId);
        if (!o || !isJitsiBoardType(o.type) || !o.liveAction) continue;
        shapeObject({ ...o, participantId });
      }
    }

    /**
     * After tracks are published, ensure every own on-stage jitsi tile
     * carries the current myUserId and audience has received it over MQTT.
     */
    function ensureJitsiTileParticipantBroadcast(myUserId: string) {
      if (!canPlay.value || !myUserId) return;
      const mySession = session.value;
      for (const o of board.value.objects) {
        if (!isJitsiBoardType(o.type)) continue;
        const isOwnTile =
          (mySession != null && o.hostId === mySession) || o.participantId === myUserId;
        if (!isOwnTile) continue;
        if (o.participantId === myUserId && o.published) continue;
        const healed = { ...o, participantId: myUserId } as BoardObject;
        UPDATE_OBJECT(healed);
        if (healed.liveAction || healed.published) {
          mqttBroadcastJitsiTile(healed, "post-publish participantId safety net");
        }
      }
    }

    /**
     * Set when lib-jitsi-meet reports CONFERENCE_JOINED / left. With a non-null
     * id, back-fills `participantId` on jitsi objects placed before myUserId
     * existed (drag racing the conference handshake) AND re-binds any
     * persisted own-tile whose `participantId` is stale from a previous
     * conference membership. Own-tiles are identified by `hostId ===
     * session.value` (set in `placeObjectOnStage`); we cannot rely on the
     * persisted participantId itself because lib-jitsi-meet assigns a
     * fresh `myUserId` on every CONFERENCE_JOINED, so the tile placed as
     * `abc123` last navigation is orphaned the next time we rejoin as
     * `xyz789` unless we proactively rewrite it.
     */
    function syncLocalJitsiParticipantId(id: string | null) {
      localJitsiParticipantId.value = id;
      if (id == null) return;
      const mySession = session.value;
      for (const o of board.value.objects) {
        if (!isJitsiBoardType(o.type)) continue;
        const missing = jitsiParticipantIdMissing(o);
        const staleOwn = mySession != null && o.hostId === mySession && o.participantId !== id;
        if (missing || staleOwn) {
          const healed = { ...o, participantId: id } as BoardObject;
          UPDATE_OBJECT(healed);
          if ((healed.published || healed.liveAction) && canPlay.value) {
            mqttBroadcastJitsiTile(healed, "participantId heal after CONFERENCE_JOINED");
          }
        }
      }
      flushPendingJitsiPublish(id);
    }

    function shapeObject(object: BoardObject) {
      // Sender always reflects their own change locally. This used to live
      // only in the `else` branch and the live branch relied on the broker
      // echo to update the sender's store. Now that `serializeForBroadcast`
      // strips `liveAction` from outgoing payloads, the echo is no longer a
      // safe round-trip for sender-local UI state — so apply locally first
      // unconditionally. UPDATE_OBJECT is idempotent, so the echo from the
      // broker is a harmless no-op for the sender.
      let payload = object;
      if (isJitsiBoardType(object.type)) {
        payload = stampJitsiParticipantId(object);
      }
      UPDATE_OBJECT(serializeObject(payload));
      if (payload.liveAction) {
        const isJitsi = isJitsiBoardType(payload.type);
        if (isJitsi && jitsiParticipantIdMissing(payload)) {
          pendingJitsiPublish.add(payload.id);
        } else {
          if (isJitsi) {
            pendingJitsiPublish.delete(payload.id);
            mqttBroadcastJitsiTile(
              payload,
              payload.published
                ? undefined
                : "first publish — remote clients get tile metadata only; video uses Jitsi WebRTC",
            );
          } else if (payload.published) {
            mqtt.sendMessage(TOPICS.BOARD, {
              type: BOARD_ACTIONS.MOVE_TO,
              object: serializeForBroadcast(payload),
              zIndex: boardStackIndexFor(payload.id),
            });
          } else {
            const toPublish = {
              ...payload,
              published: true,
              displayName: payload.displayName ?? useUserStore().nickname ?? "",
            } as BoardObject;
            UPDATE_OBJECT(serializeObject(toPublish));
            mqtt.sendMessage(TOPICS.BOARD, {
              type: BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE,
              object: serializeForBroadcast(toPublish),
            });
          }
        }
        board.value.objects
          .filter((o) => o.wornBy === payload.id)
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
    // their own action). Depth changes publish when the object is already on
    // observers' boards (`published`), not only while the green bulb is on;
    // `MOVE_TO` also carries `zIndex` so a drag after reorder cannot leave
    // audience paint order stale if a depth message was missed.
    function deleteObject(object: BoardObject) {
      const userStore = useUserStore();
      if (userStore.avatarId === object.id) {
        userStore.setAvatarId(null);
      }
      const localPayload = serializeObject(object);
      if (localPayload.drawingId) {
        // is drawing
        delete localPayload.commands;
      }
      DELETE_OBJECT(localPayload);
      pendingJitsiPublish.delete(object.id);
      // Only performers publish board deletes; audience-side orphan cleanup
      // (e.g. Jitsi.vue when a remote peer leaves) must stay local.
      // Jitsi tiles must always emit DESTROY when removed by a performer so
      // the event archive and remote clients drop metadata-only ghosts.
      const shouldBroadcastDestroy =
        canPlay.value && (isJitsiBoardType(object.type) || object.liveAction || object.published);
      if (shouldBroadcastDestroy) {
        const wirePayload = serializeForBroadcast(object);
        if (wirePayload.drawingId) {
          delete wirePayload.commands;
        }
        mqtt.sendMessage(TOPICS.BOARD, {
          type: BOARD_ACTIONS.DESTROY,
          object: wirePayload,
        });
      }
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
            diagMqttJitsiBoard("in", BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE, message.object, {
              note: "tile metadata received — Jitsi.vue still needs TRACK_ADDED on this client",
            });
            // The broadcast strips `liveAction` (serializeForBroadcast),
            // so incoming objects arrive without it. From the receiver's
            // point of view the object IS live — someone just published
            // it — so treat it as `liveAction:true, published:true` even
            // though those fields weren't on the wire. This keeps the
            // performer-side lightbulb green (rather than the initial
            // "never published" white) for objects placed by collaborators,
            // and keeps the moveable in full color (Moveable.vue grayscale
            // matches `liveAction === false`).
            //
            // Individual Jitsi streams: MQTT carries the board object
            // (type, x/y/w/h, participantId) only. Media tracks live in
            // board.tracks and are filled by lib-jitsi-meet on each
            // browser after the publisher's room.addTrack() succeeds —
            // they are never serialized onto TOPICS.BOARD.
            PUSH_OBJECT({ ...message.object, liveAction: true, published: true });
          }
          break;
        case BOARD_ACTIONS.MOVE_TO:
          if (message.object) {
            diagMqttJitsiBoard("in", BOARD_ACTIONS.MOVE_TO, message.object);
            UPDATE_OBJECT(message.object);
          }
          break;
        case BOARD_ACTIONS.DESTROY:
          if (message.object) {
            pendingJitsiPublish.delete(message.object.id);
            DELETE_OBJECT(message.object);
          }
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

    function toggleCurtainFrameLoop() {
      if (!curtain.value) return;
      const nowLoop = curtain.value.frameLoop !== false;
      drawCurtain({
        ...curtain.value,
        frameLoop: !nowLoop,
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

    // Duration of the graceful "fade out all" before tracks are stopped.
    const MASTER_FADE_OUT_MS = 3000;
    let masterFadeTimer: ReturnType<typeof setTimeout> | null = null;

    function clearMasterFadeTimer() {
      if (masterFadeTimer) {
        clearTimeout(masterFadeTimer);
        masterFadeTimer = null;
      }
    }

    function applyMasterAudioVolume(volume: number, duration: number, broadcast: boolean) {
      masterAudioVolume.value = volume;
      masterAudioSignal.value = {
        volume,
        duration,
        seq: masterAudioSignal.value.seq + 1,
      };
      if (broadcast) mqtt.sendMessage(TOPICS.AUDIO_MASTER, { volume, duration });
    }

    /** Master-volume slider. `broadcast=false` for purely-local drag feedback. */
    function setMasterAudioVolume(volume: number, broadcast = true) {
      clearMasterFadeTimer();
      applyMasterAudioVolume(volume, 0, broadcast);
    }

    /** Instantly stop every currently-playing track and reset master to full. */
    function stopAllAudio() {
      clearMasterFadeTimer();
      tools.value.audios.forEach((audio) => {
        if (!audio.isPlaying) return;
        audio.isPlaying = false;
        audio.currentTime = 0;
        audio.saken = true;
        updateAudioStatus(audio);
      });
      if (masterAudioVolume.value !== 1) applyMasterAudioVolume(1, 0, true);
    }

    /**
     * Ramp every playing track to silence over MASTER_FADE_OUT_MS, then stop
     * them all and snap the master level back to full for the next cue. Only
     * the initiating client schedules the stop; the fade and the resulting
     * per-track stops both propagate to the audience over MQTT.
     */
    function fadeOutAllAudio() {
      clearMasterFadeTimer();
      applyMasterAudioVolume(0, MASTER_FADE_OUT_MS, true);
      masterFadeTimer = setTimeout(() => {
        masterFadeTimer = null;
        stopAllAudio();
      }, MASTER_FADE_OUT_MS);
    }

    function handleAudioMasterMessage({
      message,
    }: {
      message: { volume?: number; duration?: number };
    }) {
      // Remote-driven: apply locally without re-broadcasting (avoid echo loop).
      applyMasterAudioVolume(message.volume ?? 1, message.duration ?? 0, false);
    }

    function closeSettingPopup() {
      SET_SETTING_POPUP({ isActive: false });
    }

    function openSettingPopup(setting: SettingPopup) {
      setting.isActive = true;
      SET_SETTING_POPUP(setting);
    }

    // Saving a new drawing/text places it on stage directly (no drag), so
    // auto-focus the moveable the same way Board.vue's drop handler does:
    // the very next step is always "adjust it, then light the bulb", and
    // without this the creator had to click the fresh object before its
    // frame/slider/buttons appeared. NB: for drawings the caller must leave
    // drawing mode BEFORE calling addDrawing — autoFocusMoveable refuses
    // while `preferences.isDrawing` is true (see Draw/index.vue save()).
    function addDrawing(drawing: Drawing) {
      PUSH_DRAWING(drawing);
      const placed = placeObjectOnStage(drawing as Partial<BoardObject>);
      autoFocusMoveable(placed.id);
    }

    function addText(text: TextEntity) {
      text.type = "text";
      PUSH_TEXT(text);
      const placed = placeObjectOnStage(text as Partial<BoardObject>);
      autoFocusMoveable(placed.id);
    }

    function handleReactionMessage({ message }: { message: unknown }) {
      PUSH_REACTION(message);
    }

    function sendReaction(reaction: unknown) {
      mqtt.sendMessage(TOPICS.REACTION, reaction);
    }

    /** Replace jitsi tiles on the board with the event-log final state. */
    function reconcileJitsiBoardFromEvents(events: ReplayEvent[]) {
      if (replay.value.isReplaying) return;
      const { tiles: finalTiles, destroyedIds } = computeFinalJitsiObjectsFromEvents(events);
      for (const id of destroyedIds) pendingJitsiPublish.delete(id);
      const keepIds = new Set(finalTiles.map((o) => o.id));
      board.value.objects = board.value.objects.filter(
        (o) => !isJitsiBoardType(o.type) || keepIds.has(o.id),
      );
      for (const obj of finalTiles) {
        const payload = { ...obj, liveAction: true, published: true };
        const existing = board.value.objects.find((o) => o.id === payload.id);
        if (existing) {
          // `payload` carries the event-log's coordinates in WIRE (relative)
          // form, exactly like `msg.object` on the live MQTT path. UPDATE_OBJECT
          // already runs `deserializeObject` (toAbsolute) internally, so the
          // payload must NOT be pre-serialized. The previous
          // `serializeObject({...})` wrapper double-converted: toRelative then
          // toAbsolute round-trips a relative 0.18 straight back to 0.18, which
          // was then stored as if it were 0.18 *pixels* — collapsing the tile to
          // a 0×0 box so its (playing) <video> was invisible on every receiver.
          // PUSH_OBJECT (the else branch) was always correct (one toAbsolute),
          // which is why a freshly-placed tile showed but one reconciled from
          // the event log did not.
          UPDATE_OBJECT({ ...existing, ...payload });
        } else {
          PUSH_OBJECT(payload);
        }
      }
      const activeParticipantIds = new Set(
        board.value.objects
          .filter((o) => isJitsiBoardType(o.type) && o.participantId)
          .map((o) => String(o.participantId)),
      );
      board.value.tracks = board.value.tracks.filter((t) => {
        const pid = t.getParticipantId?.();
        return pid != null && activeParticipantIds.has(String(pid));
      });
    }

    /**
     * Drop jitsi tiles whose publisher tab is no longer in the live session
     * roster (`hostId` not present in `sessions`). Crashed/closed tabs stop
     * sending COUNTER heartbeats and are removed on `leaving:true` or the
     * 60-minute trim, leaving metadata-only tiles that cannot receive tracks.
     *
     * Performer-only (audience `hostId` is always the publisher's tab id).
     * Do not treat `hostId !== mySession` as orphan — that deleted every
     * remote stream on reconnect and when navigating back before the roster
     * repopulated. Only prune when the publisher session id is absent.
     */
    function pruneOrphanJitsiTilesFromOldSessions() {
      if (replay.value.isReplaying) return;
      if (!canPlay.value) return;
      const liveSessionIds = new Set(
        sessions.value
          .filter((s) => !s.leaving)
          .map((s) => (s.id != null ? String(s.id) : ""))
          .filter((id) => id.length > 0),
      );
      // Roster not hydrated yet (e.g. right after connect) — avoid wiping tiles.
      if (liveSessionIds.size === 0) return;
      for (const o of [...board.value.objects]) {
        if (!isJitsiBoardType(o.type)) continue;
        if (o.hostId == null || o.hostId === "") continue;
        const hostId = String(o.hostId);
        if (liveSessionIds.has(hostId)) continue;
        pendingJitsiPublish.delete(o.id);
        const wirePayload = serializeForBroadcast(o);
        DELETE_OBJECT(serializeObject(o));
        if (canPlay.value && (o.published || o.liveAction)) {
          mqtt.sendMessage(TOPICS.BOARD, {
            type: BOARD_ACTIONS.DESTROY,
            object: wirePayload,
          });
        }
      }
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
              performanceId: String(recordId),
              markers: loadReplayMarkers(String(recordId)),
              timestamp: {
                begin: events[0].mqttTimestamp,
                current: events[0].mqttTimestamp,
                end: events[events.length - 1].mqttTimestamp,
              },
            });
          } else {
            const archivedEvents = events ?? [];
            archivedEvents.forEach((event: ReplayEvent) => replayEvent(event));
            reconcileJitsiBoardFromEvents(archivedEvents);
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
        reconcileJitsiBoardFromEvents(model.value.events);
      }
    }

    function replaceScene(sceneId: ObjectId) {
      animateIfPresent("#live-stage", {
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

    const chatDedupeKey = (msg: ChatMessage) =>
      `${msg.id ?? ""}:${msg.at ?? ""}:${msg.user ?? ""}:${msg.message ?? ""}`;

    /** Supplement event-stream chat with archived performance chat rows (studio DB). */
    function scheduleArchivedChats(current: number, speed: number, seenKeys: Set<string>) {
      const performanceId = replay.value.performanceId;
      if (!performanceId) return;
      const rows = model.value?.chats ?? [];
      rows.forEach((row) => {
        if (String(row.performanceId) !== String(performanceId)) return;
        let msg: ChatMessage =
          typeof row.payload === "string"
            ? (JSON.parse(row.payload) as ChatMessage)
            : ({ ...row.payload } as ChatMessage);
        const key = chatDedupeKey(msg);
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        const at = Number(msg.at ?? 0);
        if (!at) return;
        if (at - current >= 0) {
          const timer = setTimeout(
            () => {
              handleChatMessage({ message: msg });
            },
            ((at - current) * 1000) / speed,
          );
          replay.value.timers.push(timer);
        } else {
          handleChatMessage({ message: msg });
        }
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
          if (replay.value.loop) {
            void replayRecording(replay.value.timestamp.begin);
          } else {
            replay.value.timestamp.current = replay.value.timestamp.end;
            pauseReplay();
          }
        }
      }, 1000 / speed);
      const seenChatKeys = new Set<string>();
      events.forEach((event: ReplayEvent) => {
        if (unnamespaceTopic(event.topic ?? "") === TOPICS.CHAT) {
          const raw = event.payload;
          const msg =
            typeof raw === "string" ? (JSON.parse(raw) as ChatMessage) : (raw as ChatMessage);
          if (msg && typeof msg === "object") {
            seenChatKeys.add(chatDedupeKey(msg));
          }
        }
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
      scheduleArchivedChats(current, speed, seenChatKeys);
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

    /**
     * Ingest a viewer freeze report for one of OUR streams. `frozen:true`
     * records/refreshes the (viewer, tile) entry; `frozen:false` clears it.
     * Reports addressed to other performers (`hostId !== session`) are ignored.
     */
    function handleStreamHealthMessage({ message }: { message: StreamHealthMessage }) {
      if (!message || !session.value) return;
      if (message.hostId !== session.value) return;
      const viewerSession = message.viewerSession;
      const objectId = message.objectId;
      if (!viewerSession || objectId == null) return;
      const key = `${viewerSession}:${objectId}`;
      const next = new Map(frozenViewerReports.value);
      if (message.frozen) {
        next.set(key, message.at ?? +new Date());
      } else {
        next.delete(key);
      }
      frozenViewerReports.value = next;
    }

    /**
     * Viewer side: publish a freeze/recovery report for a REMOTE stream. Stamps
     * the reporting viewer's session id + timestamp. Called from
     * useStreamFreezeReporter (never for own tiles).
     */
    function reportStreamHealth(payload: {
      hostId?: unknown;
      objectId?: unknown;
      participantId?: unknown;
      frozen: boolean;
    }) {
      if (!session.value) return;
      void mqtt.sendMessage(TOPICS.STREAM_HEALTH, {
        hostId: payload.hostId,
        objectId: payload.objectId,
        participantId: payload.participantId,
        frozen: payload.frozen,
        viewerSession: session.value,
        at: +new Date(),
      });
    }

    function handleCounterMessage({ message }: { message: Session }) {
      UPDATE_SESSIONS_COUNTER(message);
      // We deliberately do NOT mirror `message.avatarId` back onto
      // `userStore.avatarId` here.
      //
      // The previous code did:
      //   if (message.id === session.value && message.avatarId) {
      //     useUserStore().avatarId = message.avatarId;
      //   }
      // The intent was "this counter message is my own echo, sync my
      // local avatarId from it" — but that only made sense back when
      // `session.value` was guaranteed to be unique per tab. Today
      // `joinStage` may derive `session.value` from the logged-in user's
      // DB id (so refreshes don't mint a new presence), which means two
      // humans signed into the *same account* — e.g. both performers
      // logging in as "admin" — share a session id. Helen's counter
      // publish then matched the local user's `session.value`, and her
      // `avatarId` got copied onto the local user's `userStore.avatarId`,
      // causing the local user's chat to be spoken by Helen's avatar
      // (and visually erasing the user's teardrop because the two
      // collided sessions were deduped in `UPDATE_SESSIONS_COUNTER`).
      //
      // The local user's `avatarId` is already set synchronously by
      // `setAvatarId` (ContextMenuAvatar / Object / Skeleton / drop on
      // stage) BEFORE the publish, and we don't want any other party's
      // claim to silently rewrite it. If we ever need a same-account
      // multi-tab "follow my own avatar across tabs" sync, it has to
      // address the local tab specifically (e.g. an instanceId field on
      // `Session`), not the user-level session id.
    }

    async function joinStage() {
      const userStore = useUserStore();
      const isPlayer = Boolean(canPlay.value);
      syncLocalSessionAvatarHold();
      // Every browser tab gets its own opaque session id, persisted in
      // sessionStorage so refreshes within the tab keep the same id (no
      // stale "ghost viewer" left behind in other clients' sessions
      // lists) but new tabs — including a second human signing in to the
      // *same account* — each get a distinct id.
      //
      // The previous implementation used `String(userStore.user.id)` for
      // logged-in performers to dodge the "fresh uuid every refresh"
      // problem. That made two performers on the same account (e.g. two
      // people both logged in as "admin") share a session id, which:
      //   * collapsed both into a single record in
      //     `UPDATE_SESSIONS_COUNTER` (only one teardrop visible), and
      //   * let `handleCounterMessage` overwrite one user's `avatarId`
      //     with the other's, so typing in chat suddenly spoke as the
      //     other person's held avatar.
      // Per-tab uuids cure both. Stale-on-crash sessions are still
      // pruned by the 60-minute trim in `UPDATE_SESSIONS_COUNTER` plus
      // the `leaving:true` publish on pagehide.
      if (!session.value) {
        session.value = readOrMintTabSessionId();
      }
      const id = session.value;
      const nickname = userStore.nickname;
      if (!isPlayer && userStore.avatarId != null) {
        userStore.$patch({ avatarId: null });
      }
      const avatarId = isPlayer ? (userStore.avatarId ?? null) : null;
      SET_ACTIVE_MOVABLE(avatarId);
      const payload = buildSessionCounterPayload({ avatarId });
      // Apply locally before the broker round-trip so teardrop / holder
      // state updates immediately on release (avatarId: null) and claim.
      UPDATE_SESSIONS_COUNTER(payload);
      await mqtt.sendMessage(TOPICS.COUNTER, payload);
      await sendStatistics();
    }

    async function leaveStage() {
      await Promise.all([sendStatisticsBeforeDisconnect(), sendCounterLeave()]);
    }

    async function sendStatisticsBeforeDisconnect() {
      const isPlayer = Boolean(canPlay.value);
      let playerCount = players.value.length;
      let audienceCount = audiences.value.length;
      if (isPlayer) {
        playerCount = Math.max(0, playerCount - 1);
      } else {
        audienceCount = Math.max(0, audienceCount - 1);
      }
      await mqtt.sendMessage(
        TOPICS.STATISTICS,
        { players: playerCount, audiences: audienceCount },
        false,
        true,
      );
    }

    function sendStatisticsBeforeDisconnectSync() {
      if (!subscribeSuccess.value) return;
      const isPlayer = Boolean(canPlay.value);
      let playerCount = players.value.length;
      let audienceCount = audiences.value.length;
      if (isPlayer) {
        playerCount = Math.max(0, playerCount - 1);
      } else {
        audienceCount = Math.max(0, audienceCount - 1);
      }
      mqtt.sendMessageSync(
        TOPICS.STATISTICS,
        { players: playerCount, audiences: audienceCount },
        false,
        true,
      );
    }

    async function sendCounterLeave() {
      releaseAvatarBeforeLeave(true);
      const id = session.value;
      session.value = null;
      CLEAN_STAGE();
      // Use fire-and-forget so this works from browser-unload handlers
      // (beforeunload / pagehide), where awaiting the broker ACK would
      // race the page tear-down and the leave message would never reach
      // the wire. The fallback to retry on dropped sockets is the 60-min
      // client-side trim in UPDATE_SESSIONS_COUNTER.
      if (id != null) {
        mqtt.sendMessageSync(TOPICS.COUNTER, { id, leaving: true });
      }
    }

    // Synchronous unload path used from beforeunload / pagehide. Skips the
    // awaited statistics-rebroadcast (which would never finish) and just
    // emits the leave message + clears local state.
    function disconnectSync() {
      stopHeartbeat();
      releaseAvatarBeforeLeave(true);
      sendStatisticsBeforeDisconnectSync();
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

    function setSuppressAvatarSpeechOutput(value: boolean) {
      suppressAvatarSpeechOutput.value = value;
    }

    function setTopbarPosition(pos: { x: number; y: number } | null) {
      topbarPosition.value = pos;
    }

    function setTopbarCollapsed(v: boolean) {
      topbarCollapsed.value = v;
    }

    function setPublicChatPosition(pos: { x: number; y: number } | null) {
      publicChatPosition.value = pos;
    }

    function resetPaletteLayout() {
      topbarPosition.value = null;
      topbarCollapsed.value = false;
      publicChatPosition.value = null;
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

    function removeTrack(track: JitsiTrack) {
      REMOVE_TRACK(track);
    }

    /** Remove a board tile locally without publishing MQTT (audience cleanup). */
    function removeObjectLocally(object: BoardObject) {
      DELETE_OBJECT(serializeObject(object));
    }

    /**
     * When a lib-jitsi-meet peer leaves, drop their on-stage tiles and any
     * lingering tracks on this client (MQTT DESTROY may never arrive).
     */
    function removeJitsiParticipantLocally(participantId: string) {
      const targets = board.value.objects.filter(
        (o) => isJitsiBoardType(o.type) && o.participantId === participantId,
      );
      for (const o of targets) {
        DELETE_OBJECT(serializeObject(o));
      }
      pruneJitsiTracksForParticipant(participantId);
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

    /**
     * Explicit user-initiated refresh (the "Refresh streams" button). Fires
     * BOTH the gentle signal (so the normal idempotent attach-retry still
     * runs) AND the force signal (which lets the publisher re-publish and the
     * viewer detach/re-attach even when the tracks look "healthy" — the only
     * way to recover a frozen-but-not-ended stream short of a full page
     * reload). The automatic page-wake path keeps calling `triggerReloadStreams`
     * (gentle only) so it never churns a working publish.
     */
    function triggerForceReloadStreams() {
      RELOAD_STREAMS();
      FORCE_RELOAD_STREAMS();
    }

    /** Remount every on-stage `meeting` iframe (embedded Jitsi conference tile). */
    function refreshMeeting() {
      REFRESH_MEETING();
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
      masterAudioVolume,
      masterAudioSignal,
      setMasterAudioVolume,
      stopAllAudio,
      fadeOutAllAudio,
      handleAudioMasterMessage,
      isSavingScene,
      isLoadingScenes,
      showPlayerChat,
      showClearChatSetting,
      showDownloadChatSetting,
      topbarPosition,
      topbarCollapsed,
      publicChatPosition,
      lastSeenPrivateMessage,
      masquerading,
      purchasePopup,
      receiptPopup,
      _reloadStreams,
      _forceReloadStreams,
      _meetingRefreshKey,
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
      liveJitsiParticipantIds,
      reloadStreams,
      forceReloadStreams,
      frozenViewerCount,
      meetingRefreshKey,
      activeObject,
      enabledLiveStreaming,
      // mutations (UPPER_SNAKE_CASE)
      SET_MODEL,
      CLEAN_STAGE,
      SET_BACKGROUND,
      SET_STATUS,
      refreshLiveStatus,
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
      REFRESH_MEETING,
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
      syncLocalJitsiParticipantId,
      ensureJitsiTileParticipantBroadcast,
      reconcileJitsiBoardFromEvents,
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
      toggleCurtainFrameLoop,
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
      syncLocalSessionAvatarHold,
      releaseAvatarHold,
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
      setSuppressAvatarSpeechOutput,
      setTopbarPosition,
      setTopbarCollapsed,
      setPublicChatPosition,
      resetPaletteLayout,
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
      removeTrack,
      removeObjectLocally,
      removeJitsiParticipantLocally,
      triggerReloadStreams,
      triggerForceReloadStreams,
      reportStreamHealth,
      refreshMeeting,
    };
  },
  {
    persist: {
      key: "upstage-stage-ui",
      pick: ["chatPosition"],
    },
  },
);

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useStageStore, import.meta.hot));
}
