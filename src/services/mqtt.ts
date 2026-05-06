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
    _connectPromise: null,
    _connectResolve: null,
    connect() {
      const { url, ...options } = config.MQTT_CONNECTION;
      const connectUrl = url;
      if (!connectUrl || typeof connectUrl !== "string") {
        console.error(
          "[MQTT] No connection URL. Set VITE_MQTT_ENDPOINT to the broker WebSocket URL (e.g. ws://localhost:9001)."
        );
      }
      const clientId = uuidv4();
      this._connectPromise = new Promise((resolve, reject) => {
        this._connectResolve = resolve;
        this._connectReject = reject;
      });
      this.client = connect(connectUrl, {
        ...options,
        clientId,
      });
      this.client.on("error", (err) => {
        console.error("[MQTT] Connection error:", err?.message ?? err);
      });
      this.client.once("connect", () => {
        if (this._connectResolve) {
          this._connectResolve();
          this._connectResolve = null;
          this._connectReject = null;
          this._connectPromise = null;
        }
      });
      return this.client;
    },
    whenConnected(timeoutMs = 10000) {
      if (!this.client) {
        return Promise.reject(new Error("[MQTT] Not connected. Call connect() first."));
      }
      if (this.client.connected) {
        return Promise.resolve();
      }
      const connectPromise =
        this._connectPromise ||
        new Promise((resolve) => {
          const onConnect = () => {
            this.client.removeListener("connect", onConnect);
            this.client.removeListener("close", onClose);
            resolve();
          };
          const onClose = () => {
            this.client.removeListener("connect", onConnect);
            this.client.removeListener("close", onClose);
          };
          this.client.once("connect", onConnect);
          this.client.once("close", onClose);
        });
      if (timeoutMs <= 0) {
        return connectPromise;
      }
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("[MQTT] Connection timeout.")), timeoutMs);
      });
      return Promise.race([connectPromise, timeoutPromise]);
    },
    disconnect() {
      if (!this.client) return Promise.resolve();
      return new Promise((resolve) => {
        this.client.end(false, {}, resolve);
      });
    },
    subscribe(topics, stageUrl) {
      if (!this.client) {
        return Promise.reject(new Error("[MQTT] Not connected. Call connect() first."));
      }
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
      if (!this.client) {
        return Promise.reject(
          new Error("[MQTT] Not connected. Call connect() first or check MQTT connection.")
        );
      }
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
      if (!this.client) return;
      this.client.on("message", (topic, rawMessage) => {
        topic = unnamespaceTopic(topic);
        const decoded = new TextDecoder().decode(new Uint8Array(rawMessage));
        const message = (isJson(decoded) && JSON.parse(decoded)) || decoded;
        handler({ topic, message });
      });
    },
  };
}
