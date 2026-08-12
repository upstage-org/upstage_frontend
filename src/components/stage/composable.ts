// @ts-nocheck
import { onUnmounted, ref } from "vue";
import buildClient from "services/mqtt";
import { BACKGROUND_ACTIONS, COLORS, TOPICS } from "utils/constants";
import { namespaceTopic } from "store/modules/stage/reusable";

// `useCounter` lived here and opened its own broker client to read the
// STATISTICS topic. It was already dead — player/audience counts moved to the
// upstage_stats-backed GraphQL fields (see PlayerAudienceCounter.vue, which
// documents that it deliberately opens no MQTT client) — and it was the one
// caller that could not supply a credential, since it had no stage payload.
// Removed rather than left as broken dead code.

export const useShortcut = (callback) => {
  const shortcutHandler = (e) => {
    if (!e) e = window.event;
    callback(e);
  };

  window.addEventListener("keydown", shortcutHandler);

  onUnmounted(() => {
    window.removeEventListener("keydown", shortcutHandler);
  });
};

export const useHoldingShift = () => {
  const isHoldingShift = ref(false);

  const callback = (e) => {
    if (!e) e = window.event;
    if (e.shiftKey) {
      isHoldingShift.value = true;
    } else {
      isHoldingShift.value = false;
    }
  };
  window.addEventListener("keydown", callback);
  window.addEventListener("keyup", callback);

  onUnmounted(() => {
    window.removeEventListener("keydown", callback);
    window.removeEventListener("keyup", callback);
  });

  return isHoldingShift;
};

// `credentials` is the `mqtt` field off the stage the caller already loaded.
export const useClearStage = (stageUrl, color, credentials) => {
  const mqttClient = buildClient();
  const clearStage = async () => {
    const client = mqttClient.connect(credentials);
    if (!client) return;
    await new Promise((resolve) => {
      client.on("connect", () => {
        mqttClient
          .sendMessage(
            namespaceTopic(TOPICS.BACKGROUND, stageUrl),
            {
              type: BACKGROUND_ACTIONS.SET_BACKDROP_COLOR,
              color: color || COLORS.DEFAULT_BACKDROP,
            },
            true,
          )
          .then(resolve);
      });
    });
  };

  return clearStage;
};
