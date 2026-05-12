// @ts-nocheck
import configs from "config";
import { onMounted, onUnmounted, ref } from "vue";
import { useStageStore } from "@stores/pinia/stage";

export const useLowLevelAPI = () => {
  const { JitsiMeetJS } = window;
  return JitsiMeetJS;
};

// Parse `VITE_JITSI_ENDPOINT` into the pieces we actually need at runtime.
// Returns `null` if the env value is missing or unparseable so callers can
// degrade gracefully without crashing the SPA at mount time.
//
// The previous code did `endpoint.replace(/(^https?:\/\/|\/)/g, "")` and then
// hard-coded `https://` / `wss://` everywhere downstream. That worked for
// production Jitsi installs (always TLS behind nginx) but broke any plain-HTTP
// local install — `http://localhost:8000/` became `localhost:8000` and the
// WebSocket dial-out went to `wss://localhost:8000/xmpp-websocket`, which
// fails the TLS handshake against a plain-HTTP server. Parse with the URL
// API instead so the chosen scheme follows the env value.
//
// Separately, the *XMPP* domain ("hosts.domain" / "hosts.muc" / "hosts.focus")
// is not necessarily the same as the HTTP host the SPA dials. The Jitsi Meet
// docker quickstart fixes the XMPP virtual host at `meet.jitsi` regardless of
// which HTTP hostname/port the web UI is exposed on — addressing the XMPP
// stream to the transport hostname (e.g. `localhost:8000`) makes Prosody
// reply with empty `<mechanisms>`, which surfaces as
//   "Strophe: Server did not offer a supported authentication mechanism".
// Allow callers to override the XMPP domain triplet via env vars; fall back
// to the previous "derive from HTTP host" behaviour for production installs
// whose XMPP domain genuinely matches the HTTP hostname.
const readEnvString = (key: string): string | undefined => {
  const raw = (import.meta as any).env?.[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
};

export const useJitsiEndpoint = () => {
  const endpoint = configs.JITSI_ENDPOINT;
  if (endpoint == null || typeof endpoint !== "string" || endpoint === "") return null;
  try {
    const url = new URL(endpoint);
    const isSecure = url.protocol === "https:";

    const xmppDomain = readEnvString("VITE_JITSI_XMPP_DOMAIN") ?? url.host;
    const mucDomain = readEnvString("VITE_JITSI_XMPP_MUC_DOMAIN") ?? `conference.${xmppDomain}`;
    const focusDomain = readEnvString("VITE_JITSI_XMPP_FOCUS_DOMAIN") ?? `focus.${xmppDomain}`;

    return {
      host: url.host,
      isSecure,
      httpScheme: isSecure ? "https" : "http",
      wsScheme: isSecure ? "wss" : "ws",
      xmppDomain,
      mucDomain,
      focusDomain,
    };
  } catch {
    return null;
  }
};

export const useJitsiDomain = () => useJitsiEndpoint()?.host ?? "";

export const useJitsi = () => {
  const joined = ref(false);
  const jitsi = { room: null, connection: null };
  const endpoint = useJitsiEndpoint();
  const stageStore = useStageStore();
  const stageUrl = stageStore.url;

  const JitsiMeetJS = useLowLevelAPI();

  onMounted(() => {
    if (!endpoint) {
      console.warn(
        "useJitsi: VITE_JITSI_ENDPOINT is unset/unparseable; skipping conference connect.",
      );
      return;
    }
    const { host, httpScheme, wsScheme, xmppDomain, mucDomain, focusDomain } = endpoint;

    // lib-jitsi-meet ships with two implementations of the bridge-channel
    // "ReceiverVideoConstraints" protocol gated by FeatureFlags:
    //
    //   sourceNameSignaling=false (legacy) →  emits
    //     {colibriClass:"ReceiverVideoConstraints",
    //      constraints:{}, lastN:-1,
    //      onStageEndpoints:[], selectedEndpoints:[]}
    //
    //   sourceNameSignaling=true  (modern) →  emits
    //     {colibriClass:"ReceiverVideoConstraints",
    //      constraints:{}, lastN:-1,
    //      onStageSources:[],   selectedSources:[]}
    //
    // JVB stable-10888+ has removed the legacy field names ("onStageEndpoints",
    // "selectedEndpoints") from `ReceiverVideoConstraintsMessage` and rejects
    // the entire message as malformed when it sees them — visible on the
    // server side as:
    //   AbstractEndpointMessageTransport.onMessage: Invalid message received
    //   (Unrecognized field "onStageEndpoints" ... not marked as ignorable
    //    (6 known properties: ..., "onStageSources", ..., "selectedSources"))
    //
    // Because the entire ReceiverVideoConstraints message is dropped, JVB
    // never receives a video subscription from this endpoint, so it forwards
    // zero video to the audience. Audio is unaffected (audio doesn't use
    // these constraints) — which exactly matches the symptom of "audio
    // renders, the spinner never clears and there's no `Render video` line".
    //
    // Flipping `sourceNameSignaling` makes the client emit the modern
    // payload that JVB stable-10888+ accepts. `sendMultipleVideoStreams`
    // and `ssrcRewritingOnBridgeSupported` are the matching transport-side
    // flags required when source-names are in use (simulcast → multi-stream,
    // and JVB rewrites SSRCs on the bridge so the receiver doesn't have to
    // deduplicate). All three are present in the bundled lib-jitsi-meet.
    JitsiMeetJS.init({
      flags: {
        sourceNameSignaling: true,
        sendMultipleVideoStreams: true,
        ssrcRewritingOnBridgeSupported: true,
      },
    });
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

    console.log("[diag] useJitsi: connection options", {
      transportHost: host,
      xmppDomain,
      mucDomain,
      focusDomain,
      httpScheme,
      wsScheme,
    });

    const connectionOptions: Record<string, unknown> = {
      hosts: {
        domain: xmppDomain,
        muc: mucDomain,
        focus: focusDomain,
      },
      bosh: `${httpScheme}://${host}/http-bind`,
    };
    if (preferWebSocket) {
      connectionOptions.serviceUrl = `${wsScheme}://${host}/xmpp-websocket?room=${encodeURIComponent(
        stageUrl,
      )}`;
      connectionOptions.websocket = `${wsScheme}://${host}/xmpp-websocket`;
    }

    jitsi.connection = new JitsiMeetJS.JitsiConnection(null, null, connectionOptions);

    jitsi.connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED, (e) => {
      console.log("Connection established", e);
      // NOTE on the Colibri "bridge channel":
      // JVB stable-10888+ has dropped SCTP-DataChannel support for the
      // bridge channel and uses the Colibri WebSocket exclusively. The
      // bridge channel carries video-quality / last-N / forwarded-endpoints
      // signalling — audio still flows over plain SRTP/RTP without it, but
      // JVB will *not* forward video until the bridge channel is open.
      //
      // The bridge-channel URL is advertised by JVB in conference
      // signalling and is fixed at `wss://` regardless of how the client
      // reached JVB (the scheme is set by `videobridge.websockets.tls`
      // in `/config/jvb.conf` inside the JVB container, which defaults to
      // `true` and is not exposed as a docker-jitsi-meet env var in older
      // images). For a plain-HTTP local Jitsi install the audience sees
      //   "Firefox can't establish a connection to ... wss://<host>/colibri-ws/..."
      //   "BridgeChannel: Channel closed: 1006"
      // and audio works but video stays on the loading spinner.
      //
      // Fix is on the Jitsi side: either expose JVB through TLS, or
      // flip `videobridge.websockets.tls = false` inside the JVB
      // container's `/config/jvb.conf`. See REMAINING_STEPS / README for
      // the docker exec one-liner.
      jitsi.room = jitsi.connection.initJitsiConference(stageUrl, {});
      jitsi.room.on(JitsiMeetJS.events.conference.TRACK_ADDED, (track) => {
        console.log("[diag] composable TRACK_ADDED", {
          type: track?.type,
          participantId: track?.getParticipantId?.(),
          trackId: track?.getId?.(),
          isLocal: track?.isLocal?.(),
        });
        stageStore.addTrack(track);
      });
      jitsi.room.on(JitsiMeetJS.events.conference.TRACK_REMOVED, (track) => {
        console.log("[diag] composable TRACK_REMOVED", {
          type: track?.type,
          participantId: track?.getParticipantId?.(),
        });
      });
      jitsi.room.on(JitsiMeetJS.events.conference.USER_JOINED, (id) => {
        console.log("[diag] composable USER_JOINED", id);
      });
      jitsi.room.on(JitsiMeetJS.events.conference.USER_LEFT, (id) => {
        console.log("[diag] composable USER_LEFT", id);
      });
      jitsi.room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, (e) => {
        console.log("Conference joined", e);
        joined.value = true;
      });
      jitsi.room.on(JitsiMeetJS.events.conference.CONFERENCE_FAILED, (...args) => {
        console.warn("[diag] composable CONFERENCE_FAILED", ...args);
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
