// @ts-nocheck
import { onUnmounted, ref } from "vue";
import buildClient from "services/mqtt";
import { BACKGROUND_ACTIONS, COLORS, TOPICS } from "utils/constants";
import { namespaceTopic } from "store/modules/stage/reusable";

export const useCounter = (stageUrl) => {
  const players = ref(0);
  const audiences = ref(0);
  const loading = ref(true);

  const mqtt = buildClient();
  const client = mqtt.connect();
  // `connect` also fires on every reconnect. If one lands after the component
  // has unmounted (and `mqtt.disconnect()` has run), subscribing throws
  // `client disconnecting` from mqtt.js `_checkDisconnecting` as an unhandled
  // rejection. Skip the subscribe once unmounted, and catch the residual race
  // where disconnect starts mid-subscribe.
  let active = true;
  client.on("connect", () => {
    if (!active) return;
    const topics = {
      [TOPICS.STATISTICS]: { qos: 2 },
    };
    mqtt
      .subscribe(topics, stageUrl)
      .then(() => {
        loading.value = false;
      })
      .catch((e) => {
        // Subscribe lost the race with a disconnect/reconnect — non-fatal.
        console.log(e);
      });
  });
  client.on("error", (e) => {
    console.log(e);
  });
  mqtt.receiveMessage(({ message }) => {
    players.value = message.players;
    audiences.value = message.audiences;
  });

  onUnmounted(() => {
    active = false;
    mqtt.disconnect();
  });

  return [players, audiences, loading];
};

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

export const useClearStage = (stageUrl, color) => {
  const mqttClient = buildClient();
  const clearStage = async () => {
    await new Promise((resolve) => {
      mqttClient.connect().on("connect", () => {
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
