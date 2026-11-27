import config from "config";
import { v4 as uuidv4 } from "uuid";
// mqtt v5's browser ESM bundle (./dist/mqtt.esm.js) ships ONLY a default
// export ("export default XT()"). A namespace import like
// `import * as mqtt from "mqtt"` therefore yields { __esModule, default }
// and `mqtt.connect` is undefined — the audience client crashes silently
// inside buildClient(), no WS is opened, and mosquitto stats stay at 0.
// Pull the default and read connect off it.
import mqtt from "mqtt";
import type { ISubscriptionGrant, ISubscriptionMap, MqttClient, Packet } from "mqtt";
const { connect } = mqtt;
import { namespaceTopic, unnamespaceTopic } from "@utils/mqttTopics";
import { isJson } from "utils/common";

export interface MqttCredentials {
  username?: string | null;
  password?: string | null;
}

export interface MqttService {
  client: MqttClient | null;
  _connectPromise: Promise<void> | null;
  _connectResolve: (() => void) | null;
  _connectReject?: ((reason?: unknown) => void) | null;
  connect(credentials?: unknown): MqttClient | null;
  whenConnected(timeoutMs?: number): Promise<void>;
  disconnect(): Promise<unknown>;
  subscribe(
    topics: Record<string, any>,
    stageUrl?: string,
  ): Promise<ISubscriptionGrant[] | undefined>;
  sendMessage(
    topic: string,
    payload: any,
    namespaced?: boolean,
    retain?: boolean,
  ): Promise<Packet | undefined>;
  sendMessageSync(topic: string, payload: any, namespaced?: boolean, retain?: boolean): void;
  receiveMessage(handler: (payload: { topic: string; message: any }) => void): void;
}

export default function buildClient(): MqttService {
  return {
    client: null,
    _connectPromise: null,
    _connectResolve: null,
    // `credentials` come from `Stage.mqtt` on the stage payload the caller has
    // already loaded — deliberately NOT from config, which would put the
    // password back in the bundle. Synchronous on purpose: every caller already
    // holds the stage object, so there is no fetch to await here and the
    // wake-recovery callbacks stay synchronous.
    connect(credentials?: MqttCredentials | null) {
      const { url, ...options } = config.MQTT_CONNECTION;
      const connectUrl = url;
      if (!connectUrl || typeof connectUrl !== "string") {
        console.error(
          "[MQTT] No connection URL. Set VITE_MQTT_ENDPOINT to the broker WebSocket URL (e.g. ws://localhost:9001).",
        );
      }
      // Fail closed. There is no build-time fallback by design, so without a
      // credential we cannot connect — return null and let the caller go
      // OFFLINE and retry, the same path a broker outage already takes.
      if (!credentials?.username || !credentials?.password) {
        console.error(
          "[MQTT] No broker credentials. Expected them on the stage payload (Stage.mqtt); " +
            "check that the stage query selects `mqtt { username password }` and that the " +
            "backend has MQTT_USER/MQTT_PASSWORD configured.",
        );
        return null;
      }
      const clientId = uuidv4();
      // A previous client (e.g. one still auto-reconnecting after the status
      // flipped to OFFLINE) must be torn down first; otherwise two live
      // clients each deliver every message and presence is published twice.
      if (this.client) {
        try {
          this.client.removeAllListeners();
          this.client.end(true);
        } catch (err) {
          console.warn("[MQTT] Failed to end previous client:", err);
        }
        this.client = null;
      }
      this._connectPromise = new Promise<void>((resolve, reject) => {
        this._connectResolve = resolve;
        this._connectReject = reject;
      });
      this.client = connect(connectUrl as string, {
        ...options,
        username: credentials.username,
        password: credentials.password,
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
        new Promise<void>((resolve) => {
          const onConnect = () => {
            this.client!.removeListener("connect", onConnect);
            this.client!.removeListener("close", onClose);
            resolve();
          };
          const onClose = () => {
            this.client!.removeListener("connect", onConnect);
            this.client!.removeListener("close", onClose);
          };
          this.client!.once("connect", onConnect);
          this.client!.once("close", onClose);
        });
      if (timeoutMs <= 0) {
        return connectPromise;
      }
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("[MQTT] Connection timeout.")), timeoutMs);
      });
      return Promise.race([connectPromise, timeoutPromise]);
    },
    disconnect() {
      if (!this.client) return Promise.resolve();
      return new Promise((resolve) => {
        this.client!.end(false, {}, resolve);
      });
    },
    subscribe(topics: Record<string, any>, stageUrl?: string) {
      if (!this.client) {
        return Promise.reject(new Error("[MQTT] Not connected. Call connect() first."));
      }
      const namespacedTopics: ISubscriptionMap = {};
      Object.keys(topics).forEach(
        (key) => (namespacedTopics[namespaceTopic(key, stageUrl)] = topics[key]),
      );
      return new Promise((resolve, reject) => {
        this.client!.subscribe(namespacedTopics, (error, res) => {
          if (error) {
            reject(error);
          } else {
            resolve(res);
          }
        });
      });
    },
    sendMessage(topic: string, payload: any, namespaced = false, retain = false) {
      if (!this.client) {
        return Promise.reject(
          new Error("[MQTT] Not connected. Call connect() first or check MQTT connection."),
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
        this.client!.publish(topic, message, { qos: 1, retain }, (error, res) => {
          if (error) {
            reject(error);
          } else {
            resolve(res);
          }
        });
      });
    },
    // Fire-and-forget publish, used from browser-unload handlers where the
    // page is about to die and we cannot wait for a broker ACK. QoS 0 +
    // no callback means the message is handed to the underlying socket
    // immediately; if the connection has already been torn down the
    // mqtt.js client buffers it but realistically it just gets dropped.
    // Better than the awaited sendMessage path, which would block on a
    // Promise that never resolves before the browser kills the JS VM.
    sendMessageSync(topic: string, payload: any, namespaced = false, retain = false) {
      if (!this.client) return;
      if (!namespaced) {
        topic = namespaceTopic(topic);
      }
      let message = payload;
      if (typeof payload === "object") {
        message = JSON.stringify(payload);
      }
      try {
        this.client.publish(topic, message, { qos: 0, retain });
      } catch (err) {
        console.warn("[MQTT] sendMessageSync failed:", err);
      }
    },
    receiveMessage(handler: (payload: { topic: string; message: any }) => void) {
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
