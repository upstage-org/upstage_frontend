import configs from "config";
import { useStageStore } from "@stores/pinia/stage";

export function namespaceTopic(topicName: string, stageUrl?: string): string {
  const url = stageUrl ?? useStageStore().url;
  const namespace = configs.MQTT_NAMESPACE;
  return `${namespace}/${url}/${topicName}`;
}

export function unnamespaceTopic(topicName: string | null | undefined): string {
  if (topicName == null || typeof topicName !== "string") return "";
  const url = useStageStore().url;
  const namespace = configs.MQTT_NAMESPACE;
  if (url == null || namespace == null) return topicName;
  const prefixLen = String(namespace).length + String(url).length + 2;
  if (topicName.length <= prefixLen) return topicName;
  return topicName.substring(prefixLen);
}
