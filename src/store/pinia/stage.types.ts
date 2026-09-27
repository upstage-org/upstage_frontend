/**
 * Shapes of the stage store (`./stage.ts`), which re-exports them: import
 * them from "@stores/pinia/stage" as before.
 */

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
  /** Live RTMP feed tile (renders via LiveStreamPlayer, not <video src>). */
  isRTMP?: boolean;
  /** Origin of the Jitsi server the tile's participant is on (multi-server
   *  streaming, `configs.JITSI_ENDPOINTS`). Absent = the default server, so
   *  every pre-existing tile, archived event and replay keeps working. Only
   *  ever written when more than one server is configured. */
  jitsiServer?: string;
  /** Frame shape for live stream tiles (jitsi + RTMP): a registry id from
   *  components/objects/frameShapes.ts. Legacy values are null/absent
   *  (per-kind default look) and "circle". Rides MQTT broadcasts untouched. */
  shape?: string | null;
  /** Exit (removal) animation for this stage assignment, seeded from the
   *  stage's assets at placement time; absent = default ("vanish"). */
  exitAnimation?: string;
  /** Exit animation duration in ms; only meaningful with exitAnimation. */
  exitSpeed?: number;
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

/** Which live-streaming transports a stage enables while streaming is on. */
export type StreamingMode = "jitsi" | "rtmp" | "both";

export interface StageConfig {
  animateDuration: number;
  reactionDuration: number;
  ratio: number;
  defaultcolor?: string;
  enabledLiveStreaming?: boolean;
  streamingMode?: StreamingMode;
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
