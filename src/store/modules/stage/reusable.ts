// @ts-nocheck
import configs from "config";
import { useStageStore } from "@stores/pinia/stage";

// `useStageStore()` is cheap to call repeatedly — Pinia caches the
// instance — so these helpers re-resolve the store on each call rather
// than memoizing a module-scoped reference (which would be initialized
// before the Pinia plugin in a few import orders).

export function toRelative(size) {
  const stageSize = useStageStore().stageSize;
  return size / stageSize.width;
}

export function toAbsolute(size) {
  const stageSize = useStageStore().stageSize;
  return size * stageSize.width;
}

export function recalcFontSize(object, f) {
  if (object.type === "text") {
    object.fontSize = f(object.fontSize.slice(0, -2)) + "px";
  }
}

export function serializeObject(object) {
  const { src, type } = object;
  object = {
    ...object,
    src: type === "video" ? null : src,
  };
  object.x = toRelative(object.x);
  object.y = toRelative(object.y);
  object.w = toRelative(object.w);
  object.h = toRelative(object.h);
  recalcFontSize(toRelative);
  return object;
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
export function serializeForBroadcast(object) {
  const result = serializeObject(object);
  delete result.liveAction;
  return result;
}

export function deserializeObject(object) {
  if (object.type === "video") {
    delete object.src;
  }
  object.x = toAbsolute(object.x);
  object.y = toAbsolute(object.y);
  object.w = toAbsolute(object.w);
  object.h = toAbsolute(object.h);
  recalcFontSize(toAbsolute);
  return object;
}

export function namespaceTopic(topicName, stageUrl) {
  const url = stageUrl ?? useStageStore().url;
  const namespace = configs.MQTT_NAMESPACE;
  return `${namespace}/${url}/${topicName}`;
}

export function unnamespaceTopic(topicName) {
  if (topicName == null || typeof topicName !== "string") return "";
  const url = useStageStore().url;
  const namespace = configs.MQTT_NAMESPACE;
  if (url == null || namespace == null) return topicName;
  const prefixLen = String(namespace).length + String(url).length + 2;
  if (topicName.length <= prefixLen) return topicName;
  return topicName.substring(prefixLen);
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
  tools.audios?.forEach((audio) => {
    stageStore.updateAudioStatus({
      ...audio,
      isPlaying: false,
    });
  });
  return payload;
}
