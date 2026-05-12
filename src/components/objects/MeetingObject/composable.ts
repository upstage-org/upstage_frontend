// @ts-nocheck
import configs from "config";
import { onMounted, onUnmounted, ref } from "vue";
import { useStageStore } from "@stores/pinia/stage";

export const useLowLevelAPI = () => {
  const { JitsiMeetJS } = window;
  return JitsiMeetJS;
};

export const useJitsiDomain = () => {
  const endpoint = configs.JITSI_ENDPOINT;
  if (endpoint == null || typeof endpoint !== "string") return "";
  return endpoint.replace(/(^https?:\/\/|\/)/g, "");
};

export const useJitsi = () => {
  const joined = ref(false);
  const jitsi = { room: null, connection: null };
  const domain = useJitsiDomain();
  const stageStore = useStageStore();
  const stageUrl = stageStore.url;

  const JitsiMeetJS = useLowLevelAPI();

  onMounted(() => {
    JitsiMeetJS.init();
    JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);

    // Transport selection. Modern Jitsi servers expose XMPP-over-WebSocket
    // at `/xmpp-websocket`, which is lower latency than BOSH (long-poll
    // HTTP) and avoids the Firefox + HTTP/2 + long-poll edge cases that
    // motivated `views/live/FirefoxWarning.vue`. We prefer the WebSocket
    // transport, with BOSH kept as a fallback and toggleable via env var
    // (`VITE_JITSI_PREFER_WEBSOCKET=false`) for installs whose Jitsi
    // server hasn't been configured for WebSocket.
    const preferWebSocket = (() => {
      const raw = (import.meta as any).env?.VITE_JITSI_PREFER_WEBSOCKET;
      if (raw === undefined) return true;
      return String(raw).toLowerCase() !== "false";
    })();

    const connectionOptions: Record<string, unknown> = {
      hosts: {
        domain: domain,
        muc: `conference.${domain}`,
        focus: `focus.${domain}`,
      },
      bosh: `https://${domain}/http-bind`,
    };
    if (preferWebSocket) {
      connectionOptions.serviceUrl = `wss://${domain}/xmpp-websocket?room=${encodeURIComponent(
        stageUrl,
      )}`;
      connectionOptions.websocket = `wss://${domain}/xmpp-websocket`;
    }

    jitsi.connection = new JitsiMeetJS.JitsiConnection(null, null, connectionOptions);

    jitsi.connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED, (e) => {
      console.log("Connection established", e);
      jitsi.room = jitsi.connection.initJitsiConference(stageUrl, {});
      jitsi.room.on(JitsiMeetJS.events.conference.TRACK_ADDED, (track) => {
        stageStore.addTrack(track);
      });
      jitsi.room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, (e) => {
        console.log("Conference joined", e);
        joined.value = true;
      });

      jitsi.room.join();
    });
    jitsi.connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_FAILED, (e) => {
      console.error("Connection failed", e);
      joined.value = false;
    });
    jitsi.connection.addEventListener(
      JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
      (e) => {
        console.error("Connection disconnected", e);
        joined.value = false;
      },
    );

    jitsi.connection.connect();
  });

  // Tear down the XMPP/BOSH/WebSocket connection on unmount so it does
  // not leak across stage navigation. Browsers diverge on cleanup of
  // idle long-poll/WebSocket connections (Chromium aggressively closes,
  // Firefox keeps them alive much longer, iOS Safari may not resume
  // cleanly after backgrounding) — explicit teardown gives consistent
  // behaviour everywhere.
  onUnmounted(() => {
    try {
      // `leave()` returns a Promise on lib-jitsi-meet; swallow rejection
      // so an in-flight conference shutdown does not crash unmount.
      const leave = jitsi.room?.leave?.();
      if (leave && typeof leave.catch === "function") {
        leave.catch(() => {});
      }
    } catch (err) {
      console.warn("jitsi.room.leave() during unmount:", err);
    }
    try {
      jitsi.connection?.disconnect?.();
    } catch (err) {
      console.warn("jitsi.connection.disconnect() during unmount:", err);
    }
    joined.value = false;
  });

  return [jitsi, joined];
};
