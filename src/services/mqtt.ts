// @ts-nocheck
import config from "config";
import { v4 as uuidv4 } from "uuid";
import { connect } from "mqtt/dist/mqtt";
import {
  namespaceTopic,
  unnamespaceTopic,
} from "store/modules/stage/reusable";
import { isJson } from "utils/common";

export default function buildClient() {
  return {
    client: null,
    connect() {
      const { url, ...options } = config.MQTT_CONNECTION;
      const connectUrl = url;
      const clientId = uuidv4();
      this.client = connect(connectUrl, {
        ...options,
        clientId,
      });
      return this.client;
    },
    disconnect() {
      return new Promise((resolve) => {
        this.client.end(false, {}, resolve);
      });
    },
    subscribe(topics, stageUrl) {
      const namespacedTopics = {};
      Object.keys(topics).forEach(
        (key) =>
          (namespacedTopics[namespaceTopic(key, stageUrl)] = topics[key]),
      );
      return new Promise((resolve, reject) => {
        this.client.subscribe(namespacedTopics, (error, res) => {
          if (error) {
            reject(error);
          } else {
            resolve(res);
          }
        });
      });
    },
    sendMessage(topic, payload, namespaced, retain = false) {
      if (!namespaced) {
        topic = namespaceTopic(topic);
      }
      let message = payload;
      if (typeof payload === "object") {
        message = JSON.stringify(payload);
      }
      console.log(topic, message);
      return new Promise((resolve, reject) => {
        this.client.publish(
          topic,
          message,
          { qos: 1, retain },
          (error, res) => {
            if (error) {
              reject(error);
            } else {
              resolve(res);
            }
          },
        );
      });
    },
    receiveMessage(handler) {
      this.client.on("message", (topic, rawMessage) => {
        topic = unnamespaceTopic(topic);
        const decoded = new TextDecoder().decode(new Uint8Array(rawMessage));
        const message = (isJson(decoded) && JSON.parse(decoded)) || decoded;
        handler({ topic, message });
      });
    },
  };
}
