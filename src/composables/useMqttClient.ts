import { onScopeDispose } from "vue";
import buildClient from "@services/mqtt";

/**
 * Composable wrapper around the existing MQTT client factory.
 *
 * The original code instantiated a single MQTT client at the module-load time
 * of `store/modules/stage/index.ts`, leaking across HMR. New components should
 * prefer this composable so the client is owned by a Vue scope and can be
 * disposed when the scope is destroyed.
 *
 * To keep the migration safe, the legacy module-level client in
 * `store/modules/stage/index.ts` is preserved during the transition; consumers
 * that have not yet migrated will continue to use it.
 */
export const useMqttClient = () => {
  const client = buildClient();

  onScopeDispose(() => {
    try {
      const mqttClient = (client as unknown as {
        client?: { end?: (force?: boolean) => void };
      }).client;
      mqttClient?.end?.(true);
    } catch (err) {
      console.warn("[MQTT] disposal failed", err);
    }
  });

  return client;
};
