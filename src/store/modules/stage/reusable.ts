import { useStageStore } from "@stores/pinia/stage";
import { isJitsiBoardType, isStreamPlaybackBoardType } from "@utils/common";

export { namespaceTopic, unnamespaceTopic } from "@utils/mqttTopics";

// `useStageStore()` is cheap to call repeatedly — Pinia caches the
// instance — so these helpers re-resolve the store on each call rather
// than memoizing a module-scoped reference (which would be initialized
// before the Pinia plugin in a few import orders).

export function toRelative(size: number) {
  const stageSize = useStageStore().stageSize;
  return size / stageSize.width;
}

export function toAbsolute(size: number) {
  const stageSize = useStageStore().stageSize;
  return size * stageSize.width;
}

export function recalcFontSize(
  object: { type?: string; fontSize?: string },
  f: (n: number) => number,
) {
  if (object.type === "text") {
    object.fontSize = f(Number(object.fontSize?.slice(0, -2))) + "px";
  }
}

// Generic over the caller's object type: stage.ts passes its typed
// BoardObject and gets the same type back; the wire shape is untouched.
export function serializeObject<T extends Record<string, any>>(object: T): T {
  const { src, type } = object;
  const result: Record<string, any> = {
    ...object,
    src: isStreamPlaybackBoardType(type) ? null : src,
  };
  result.x = toRelative(result.x);
  result.y = toRelative(result.y);
  result.w = toRelative(result.w);
  result.h = toRelative(result.h);
  // NOTE: `recalcFontSize(toRelative)` used to be called here with one
  // argument, i.e. it never did anything (object was the function, `f`
  // undefined). Scaling font sizes on the wire is a format change that old
  // clients and archived performances would not understand (review B-11),
  // so the no-op is dropped rather than "fixed".
  return result as T;
}

// Same as serializeObject but strips fields that are sender-local UI
// state and must NOT leak onto the MQTT BOARD topic. `liveAction` in
// particular controls whether the SENDER's drags publish; when it
// piggybacks on every payload, audience clients end up with
// `liveAction: false` in their local store and render the object in
// grayscale (the "audience should never see this" bug). Use this when
// building objects for `mqtt.sendMessage(TOPICS.BOARD, ...)`; use
// `serializeObject` for paths that feed back into our OWN store via
// UPDATE_OBJECT, where preserving `liveAction` is the whole point.
export function serializeForBroadcast<T extends Record<string, any>>(object: T): T {
  const result: Record<string, any> = serializeObject(object);
  delete result.liveAction;
  return result as T;
}

export function deserializeObject<T extends Record<string, any>>(object: T): T {
  const target: Record<string, any> = object;
  if (isStreamPlaybackBoardType(target.type)) {
    target.type = "video";
    delete target.src;
  } else if (isJitsiBoardType(target.type)) {
    target.type = "jitsi";
  }
  target.x = toAbsolute(target.x);
  target.y = toAbsolute(target.y);
  target.w = toAbsolute(target.w);
  target.h = toAbsolute(target.h);
  // See serializeObject: the one-argument recalcFontSize call was a no-op.
  return object;
}

export function getDefaultStageConfig() {
  return {
    animateDuration: 1000,
    reactionDuration: 5000,
    ratio: 16 / 9,
  };
}

export function getDefaultStageSettings() {
  return {
    chatVisibility: true,
    chatDarkMode: false,
    reactionVisibility: true,
  };
}

export function takeSnapshotFromStage() {
  const stageStore = useStageStore();
  const {
    background,
    backdropColor,
    board: originalBoard,
    settings,
    audioPlayers,
    tools,
  } = stageStore;
  const board = Object.assign({}, originalBoard);
  board.objects = originalBoard.objects.filter((o) => o.liveAction).map(serializeObject);
  board.tracks = [];
  const payload = JSON.stringify({
    background,
    backdropColor,
    board,
    settings,
    audioPlayers,
    audios: tools.audios,
  });
  // Taking a snapshot must NOT mutate or broadcast live audio. Previously this
  // stopped every track via `updateAudioStatus({ isPlaying: false })`, which
  // publishes over MQTT (TOPICS.AUDIO) — so opening the Save-Scene dialog cut
  // the audio for EVERY player on the stage, not just the one saving. The scene
  // payload above already captured the current audio state, so there is nothing
  // more to do here; leave live playback untouched for everyone.
  return payload;
}
