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
      // Check if client exists
      if (!this.client) {
        return Promise.resolve([]); // Return resolved promise instead of rejecting
      }
      
      const namespacedTopics = {};
      Object.keys(topics).forEach(
        (key) =>
          (namespacedTopics[namespaceTopic(key, stageUrl)] = topics[key]),
      );
      
      return new Promise((resolve) => {
        try {
          // Let MQTT library handle state checks - it will queue if needed
          // The library automatically handles disconnecting state and will retry on reconnect
          this.client.subscribe(namespacedTopics, (error, res) => {
            if (error) {
              // Check if error is about disconnecting - this is expected during reconnection
              const errorMsg = error.message || error.toString() || String(error);
              if (errorMsg.includes("disconnecting") || 
                  errorMsg.includes("client disconnecting") ||
                  errorMsg.includes("not connected")) {
                // Silently resolve - MQTT will auto-retry on reconnect
                resolve([]);
              } else {
                // For other errors, still resolve to prevent unhandled promise rejection
                // Log for debugging but don't break the app
                console.debug("MQTT subscribe error (non-disconnecting):", errorMsg);
                resolve([]);
              }
            } else {
              resolve(res);
            }
          });
        } catch (error) {
          // Handle synchronous errors (like the one thrown by _checkDisconnecting)
          const errorMsg = error?.message || error?.toString() || String(error);
          if (errorMsg.includes("disconnecting") || 
              errorMsg.includes("client disconnecting") ||
              errorMsg.includes("not connected")) {
            // Silently resolve for disconnecting errors - MQTT will retry
            resolve([]);
          } else {
            // Always resolve to prevent unhandled promise rejection
            console.debug("MQTT subscribe caught error:", errorMsg);
            resolve([]);
          }
        }
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
