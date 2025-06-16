// @ts-nocheck
import configs from "config";
import { useStageStore } from './index';

export function toRelative(size) {
  const stageStore = useStageStore();
  const stageSize = stageStore.stageSize;
  return size / stageSize.width;
}

export function toAbsolute(size) {
  const stageStore = useStageStore();
  const stageSize = stageStore.stageSize;
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
  recalcFontSize(object, toRelative);
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
  recalcFontSize(object, toAbsolute);
  return object;
}

export function namespaceTopic(topicName, stageUrl) {
  const stageStore = useStageStore();
  const url = stageUrl ?? stageStore.url;
  const namespace = configs.MQTT_NAMESPACE;
  return `${namespace}/${url}/${topicName}`;
}

export function unnamespaceTopic(topicName) {
  const stageStore = useStageStore();
  const url = stageStore.url;
  const namespace = configs.MQTT_NAMESPACE;
  return topicName.substring(namespace.length + url.length + 2);
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
  board.objects = originalBoard.objects
    .filter((o) => o.liveAction)
    .map(serializeObject);
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
