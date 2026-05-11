// @ts-nocheck
import configs from "config";
import { useStageStore } from "@stores/pinia/stage";

// These helpers used to read from the Vuex root store. They now go
// straight to the Pinia stage store; during Wave D the Vuex stage
// module is a thin Pinia-backed facade, so the previous indirection
// added a Proxy hop with no benefit. `useStageStore()` is cheap to
// call repeatedly — Pinia caches the instance.

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
