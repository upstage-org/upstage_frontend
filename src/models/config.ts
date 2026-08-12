export interface SharedConfigs {
  GRAPHQL_ENDPOINT: string;
  STATIC_ASSETS_ENDPOINT: string;
  AXIOS_TIMEOUT: number;
  ACCESS_TOKEN_KEY: string;
  MQTT_NAMESPACE: string;
  MQTT_CONNECTION: MqttConnection;
  STREAMING: Streaming;
}

/** Transport settings only — see the note on `MQTT_CONNECTION` in config.ts. */
export interface MqttConnection {
  url: string;
  clean: boolean;
  connectTimeout: number;
  reconnectPeriod: number;
  retain: boolean;
}

/** Broker login served per stage on `Stage.mqtt`, never bundled. */
export interface MqttCredentials {
  username: string;
  password: string;
}

export interface Streaming {
  publish: string;
  subscribe: string;
  auth: Auth;
}

export interface Auth {
  username: string;
  password: string;
}

export interface SharedAuth {
  refresh_token: string;
  token: string;
  username: string;
}
