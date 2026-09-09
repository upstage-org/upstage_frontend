// @ts-nocheck
import configs from "config";
import { nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { isJitsiBoardType } from "@utils/common";

export const useLowLevelAPI = () => {
  const { JitsiMeetJS } = window;
  return JitsiMeetJS;
};

// "Has loadStage populated the stage URL yet?" — the store's `url` getter
// returns "" until the model arrives. Only null/undefined/"" count as
// not-loaded: a previous version also matched the literal "demo", which
// permanently disabled Jitsi on the real Demo Stage (fileLocation "demo").
// Exported for unit tests.
export const isPlaceholderStageUrl = (u: unknown) => u == null || u === "";

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

//
// Multi-server streaming: `origin` selects one of `configs.JITSI_ENDPOINTS`.
// Omitted ⇒ the default server (entry 0) — exactly the previous behaviour.
// The `VITE_JITSI_XMPP_*` overrides describe the DEFAULT server's XMPP
// layout only; additional servers rely on their own `config.js` (which
// `startConnection` prefers anyway) with the derived defaults as fallback.
export const useJitsiEndpoint = (origin?: string) => {
  const endpoint = origin ?? configs.JITSI_ENDPOINT;
  if (endpoint == null || typeof endpoint !== "string" || endpoint === "") return null;
  const isDefaultServer = origin == null || origin === configs.JITSI_ENDPOINT;
  try {
    const url = new URL(endpoint);
    const isSecure = url.protocol === "https:";

    const envOverride = (key: string) => (isDefaultServer ? readEnvString(key) : undefined);
    const xmppDomain = envOverride("VITE_JITSI_XMPP_DOMAIN") ?? url.host;
    const mucDomain = envOverride("VITE_JITSI_XMPP_MUC_DOMAIN") ?? `conference.${xmppDomain}`;
    const focusDomain = envOverride("VITE_JITSI_XMPP_FOCUS_DOMAIN") ?? `focus.${xmppDomain}`;

    return {
      host: url.host,
      isSecure,
      httpScheme: isSecure ? "https" : "http",
      wsScheme: isSecure ? "wss" : "ws",
      xmppDomain,
      mucDomain,
      focusDomain,
      origin: endpoint,
      isDefaultServer,
    };
  } catch {
    return null;
  }
};

export const useJitsiDomain = () => useJitsiEndpoint()?.host ?? "";

/**
 * Load the Jitsi server's own `config.js` and extract the canonical
 * XMPP hosts + transport URLs from it.
 *
 * Why: the previously hard-coded `conference.${domain}` / `focus.${domain}`
 * prefixes are docker-jitsi-meet defaults, but installs that follow the
 * other Jitsi reference deployment use `muc.${domain}` (no focus
 * component is advertised — modern Jicofo handles focus discovery
 * dynamically). Sending MUC presence to the wrong component is a
 * silent hang: Prosody/ejabberd drops the stanza, no error comes back,
 * `room.join()` returns successfully, and `CONFERENCE_JOINED` never
 * fires — exactly the symptom we spent a long time chasing.
 *
 * The server-shipped `config.js` is the ground truth. The iframe-based
 * `<MeetingObject>` works because it loads that file directly; this
 * helper brings the same source of truth to the lib-jitsi-meet path.
 *
 * Implementation: `config.js` is a vanilla JS file that builds a global
 * `config` object via assignments + string concatenations referencing
 * locally-scoped helpers (`subdir`, `subdomain`). Two viable load
 * strategies:
 *
 *   1. `fetch + new Function(text)` — sandbox-execute the source and
 *      return the resulting `config`. Doesn't pollute `window`. Needs
 *      both CORS (server must emit Access-Control-Allow-Origin) AND a
 *      CSP that permits `unsafe-eval`. The Jitsi server here doesn't
 *      send a CORS header, so this path is unreachable.
 *
 *   2. `<script src=...>` injection — bypasses CORS because script
 *      loads are not subject to it, and runs at the page scope so the
 *      `var config = {}` declarations end up on `window`. We pay a
 *      tiny global namespace cost (`window.config`) which is acceptable
 *      because the SPA itself never reads `window.config` (grep'd) and
 *      Jitsi's iframe approach already implicitly relies on this same
 *      pattern.
 *
 * Going with (2). Cached per host so repeat calls (route changes,
 * reconnect attempts) don't re-inject the same script.
 */
const serverConfigCache = new Map<string, Promise<Record<string, any> | null>>();
// Multi-server streaming: every server's config.js assigns the SAME global
// (`window.config`), so two injections in flight at once would let the
// second script clobber the first before its onload read it. Chain the
// injections so each `window.config` is read before the next script is
// appended. With one server this is a single `Promise.resolve().then(...)`.
let serverConfigQueue: Promise<unknown> = Promise.resolve();
export const loadJitsiServerConfig = (
  httpScheme: string,
  host: string,
): Promise<Record<string, any> | null> => {
  const cacheKey = `${httpScheme}://${host}`;
  const existing = serverConfigCache.get(cacheKey);
  if (existing) return existing;
  const inject = () =>
    new Promise<Record<string, any> | null>((resolve) => {
      try {
        const script = document.createElement("script");
        script.src = `${cacheKey}/config.js`;
        script.async = true;
        // Deliberately NOT setting `crossOrigin`. The Jitsi server does
        // not emit `Access-Control-Allow-Origin`, so requesting CORS
        // validation would block the load. As a plain classic script the
        // browser executes the response without exposing its bytes to JS
        // — which is exactly what we need (we read `window.config`
        // afterwards, not the script source).
        const cleanup = () => {
          script.onload = null;
          script.onerror = null;
        };
        script.onload = () => {
          cleanup();
          const cfg = (window as any).config ?? null;
          console.log("[diag] loadJitsiServerConfig loaded", {
            hostsDomain: cfg?.hosts?.domain,
            hostsMuc: cfg?.hosts?.muc,
            hostsFocus: cfg?.hosts?.focus,
            websocket: cfg?.websocket,
            bosh: cfg?.bosh,
          });
          resolve(cfg);
        };
        script.onerror = (ev) => {
          cleanup();
          console.warn("[diag] loadJitsiServerConfig script error", ev);
          resolve(null);
        };
        document.head.appendChild(script);
      } catch (err) {
        console.warn("[diag] loadJitsiServerConfig threw", err);
        resolve(null);
      }
    });
  const promise = serverConfigQueue.then(inject);
  serverConfigQueue = promise.catch(() => null);
  serverConfigCache.set(cacheKey, promise);
  return promise;
};

export const useJitsi = () => {
  const joined = ref(false);
  // Reactive ref of the local performer's `JitsiTrack`s the moment
  // `createLocalTracks` resolves in `Yourself.vue`, *before* the
  // conference's `room.addTrack()` round-trip. Used by `Jitsi.vue`'s
  // own-tile branch as a fallback path so the performer can see their
  // own dragged stream rendering on the stage without waiting for —
  // or depending on — `CONFERENCE_JOINED`. Cross-peer broadcast still
  // requires the conference, but the local preview/on-stage tile no
  // longer hangs on a spinner when the MUC join silently stalls.
  //
  // shallowRef is intentional: `JitsiTrack` instances mutate internal
  // state and replace MediaStream references; deep reactivity would
  // try to proxy through them and either trip lib-jitsi-meet's
  // identity checks or thrash recompute. We only need to know when
  // the *array* changes, not when individual track internals change.
  const localTracks = shallowRef([]);
  // Multi-server streaming additions on the same object (so every
  // `inject("jitsi")` consumer keeps its reference):
  //   server         — origin this tab publishes to (ref)
  //   switchServer   — performer picks another server (see below)
  //   viewerSessions — read-only view of the extra receive-only sessions
  //   switching      — a switch is in flight (ref, disables the picker)
  const server = ref(configs.JITSI_ENDPOINT);
  const switching = ref(false);
  const viewerSessions = new Map();
  const jitsi = {
    room: null,
    connection: null,
    localTracks,
    server,
    switching,
    viewerSessions,
    switchServer: async (_origin: string) => false,
  };
  const stageStore = useStageStore();

  const JitsiMeetJS = useLowLevelAPI();

  // More than one Jitsi server configured? Everything multi-server below is
  // gated on this so a single-server build's calls into the store carry no
  // server argument and behave byte-for-byte as before.
  const multiServer = (configs.JITSI_SERVER_COUNT ?? 1) > 1;
  const jitsiServers = (configs.JITSI_ENDPOINTS ?? [configs.JITSI_ENDPOINT]).filter(Boolean);

  // The session whose room/connection are exposed as `jitsi.room` /
  // `jitsi.connection` and whose join state drives the shared `joined` ref.
  // Viewer sessions (other servers) and a not-yet-swapped-in switch target
  // never touch the shared state.
  let activeSession = null;
  let currentStageUrl = "";

  /**
   * `stageStore.url` is empty until `loadStage()` populates `model.value`.
   * Shell.vue calls `useJitsi()` inside Layout.vue's template, which mounts
   * in the same tick that `loadStage` is *kicked off* (async, network-bound),
   * so code that read the URL at mount time captured the unloaded placeholder
   * and pinned the conference to a sentinel room for the rest of the session —
   * the performer joined a room nobody else is in, and even local-tile
   * rendering was brittle because the per-participantId filter races with
   * myUserId timing on a not-really-joined room.
   *
   * Defer connection setup until `stageStore.url` resolves to the real
   * stage URL via a one-shot watcher inside `onMounted`.
   *
   * NOTE: the placeholder is the EMPTY string only. The store's fallback
   * used to be the literal `"demo"`, and this watcher treated `"demo"` as
   * never-loaded — which permanently disabled Jitsi on the real Demo Stage
   * (fileLocation === "demo"). Any real fileLocation must count as loaded.
   */
  /**
   * One XMPP connection + one conference on ONE Jitsi server. The body is
   * the previous `startConnection`, parameterised by `origin` and by the
   * object (`target`) whose `room` / `connection` it fills in:
   *   - the initial publish session targets `jitsi` itself (unchanged
   *     behaviour: Jitsi.vue / Yourself.vue / the publisher read
   *     `jitsi.room`), and is the `activeSession` from creation;
   *   - viewer sessions (multi-server only) target a private object and are
   *     never active — they only feed `stageStore.addTrack` /
   *     `removeJitsiParticipantLocally`, tagged with their origin;
   *   - a `switchServer` target starts inactive and is swapped into `jitsi`
   *     once joined.
   * `initLib` runs `JitsiMeetJS.init` exactly as the old code did for the
   * first session; extra sessions must not re-init the global lib.
   */
  const createJitsiSession = ({ origin, stageUrl, target, initLib }) => {
    const session = {
      origin,
      target,
      joined: ref(false),
      leave: () => {},
      isActive: () => activeSession === session,
      // Session-local join state, mirrored into the shared `joined` only
      // while this is the active publish session.
      markJoined: (value: boolean) => {
        session.joined.value = value;
        if (session.isActive()) joined.value = value;
      },
    };
    const markJoined = session.markJoined;
    session.leave = () => {
      try {
        const leave = target.room?.leave?.();
        if (leave && typeof leave.catch === "function") leave.catch(() => {});
      } catch (err) {
        console.warn("target.room.leave():", err);
      }
      try {
        target.connection?.disconnect?.();
      } catch (err) {
        console.warn("target.connection.disconnect():", err);
      }
      markJoined(false);
    };
    void startSession(session, { origin, stageUrl, target, initLib });
    return session;
  };

  const startSession = async (session, { origin, stageUrl, target, initLib }) => {
    const endpoint = useJitsiEndpoint(origin);
    const serverTag = multiServer ? origin : undefined;
    const markJoined = session.markJoined;
    if (!endpoint) {
      console.warn(
        "useJitsi: VITE_JITSI_ENDPOINT is unset/unparseable; skipping conference connect.",
      );
      return;
    }
    console.log("[diag] useJitsi: starting connection", { stageUrl, origin });
    const { host, httpScheme, wsScheme } = endpoint;

    // Pull the Jitsi server's own host configuration before connecting.
    // The previously derived `conference.${domain}` / `focus.${domain}`
    // defaults are docker-jitsi-meet conventions; this install (and many
    // others) uses `muc.${domain}` with no separate focus component.
    // Letting the server's `config.js` win — overlaid by env vars if
    // anyone needs to force a value — ensures we send MUC presence to
    // the JID the server is actually listening on. Without this, the
    // presence is silently dropped and `CONFERENCE_JOINED` never fires
    // (the long "preview works but other browsers can't see me" bug).
    const serverCfg = await loadJitsiServerConfig(httpScheme, host);
    // The env overrides describe the default server only (see useJitsiEndpoint).
    const envXmpp = endpoint.isDefaultServer ? readEnvString("VITE_JITSI_XMPP_DOMAIN") : undefined;
    const envMuc = endpoint.isDefaultServer
      ? readEnvString("VITE_JITSI_XMPP_MUC_DOMAIN")
      : undefined;
    const envFocus = endpoint.isDefaultServer
      ? readEnvString("VITE_JITSI_XMPP_FOCUS_DOMAIN")
      : undefined;
    const xmppDomain = envXmpp ?? serverCfg?.hosts?.domain ?? endpoint.xmppDomain;
    const mucDomain = envMuc ?? serverCfg?.hosts?.muc ?? endpoint.mucDomain;
    // `config.hosts.focus` is unset on modern Jicofo deployments — leave
    // `focus` out of the connectionOptions when neither env nor server
    // advertise it, so lib-jitsi-meet falls back to dynamic discovery
    // instead of dialing a hard-coded `focus.${domain}` that doesn't
    // resolve.
    const focusDomain = envFocus ?? serverCfg?.hosts?.focus ?? null;
    const serverWebsocket = typeof serverCfg?.websocket === "string" ? serverCfg.websocket : null;
    const serverBosh = typeof serverCfg?.bosh === "string" ? serverCfg.bosh : null;
    console.log("[diag] useJitsi: resolved hosts", {
      xmppDomain,
      mucDomain,
      focusDomain,
      serverWebsocket,
      serverBosh,
      fromEnv: { envXmpp, envMuc, envFocus },
      fromServer: !!serverCfg,
    });

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
    if (initLib) {
      JitsiMeetJS.init({
        flags: {
          sourceNameSignaling: true,
          sendMultipleVideoStreams: true,
          ssrcRewritingOnBridgeSupported: true,
        },
      });
    }
    // WARN keeps the console quiet in production while still surfacing
    // genuine XMPP/MUC/focus handshake failures (e.g. "ConferenceFocus not
    // found", "Could not allocate channels", presence rejections).
    //
    // This was temporarily raised to INFO while chasing the audience-no-video
    // bug, because the Colibri bridge-channel decision lib-jitsi-meet logs at
    // info level inside `_setBridgeChannel` ("SCTP: offered=…", "Using
    // colibri-ws url …", "BridgeChannel … Channel closed: 1006") was needed to
    // see bridge state directly. That root cause is now fixed, so we drop back
    // to WARN. Our own explicit `[diag]` console.log taps below stay regardless
    // of this level, so the stream lifecycle remains observable. If the bug
    // ever recurs, bump this one line back to INFO to re-expose bridge logs.
    if (initLib) JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.WARN);

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

    const hostsObj: Record<string, string> = {
      domain: xmppDomain,
      muc: mucDomain,
    };
    if (focusDomain) hostsObj.focus = focusDomain;

    // Prefer the server-published transport URLs (from `config.js`) so
    // hostnames/paths match what the server actually serves. Fall back
    // to constructing them from the endpoint host. Append the `?room=`
    // hint that jitsi-videobridge uses to associate the WS with a
    // specific conference when present.
    const baseBosh = serverBosh ?? `${httpScheme}://${host}/http-bind`;
    const baseWs = serverWebsocket ?? `${wsScheme}://${host}/xmpp-websocket`;

    console.log("[diag] useJitsi: connection options", {
      transportHost: host,
      xmppDomain,
      mucDomain,
      focusDomain,
      httpScheme,
      wsScheme,
      hostsObj,
      baseBosh,
      baseWs,
    });

    const connectionOptions: Record<string, unknown> = {
      hosts: hostsObj,
      bosh: baseBosh,
    };
    if (preferWebSocket) {
      const sep = baseWs.indexOf("?") >= 0 ? "&" : "?";
      connectionOptions.serviceUrl = `${baseWs}${sep}room=${encodeURIComponent(stageUrl)}`;
      connectionOptions.websocket = baseWs;
    }

    target.connection = new JitsiMeetJS.JitsiConnection(null, null, connectionOptions);

    // Raw XMPP stanza tracing.
    //
    // First attempt was to set `rawInput` / `rawOutput` on the Strophe
    // connection at `target.connection.xmpp.connection`. Strophe's
    // WebSocket transport (which lib-jitsi-meet picks here because of
    // `serviceUrl: wss://…/xmpp-websocket?room=…`) bypasses those for
    // outbound traffic in this version, so the hooks attached cleanly
    // but never fired. The `xmlInput` / `xmlOutput` hooks have the
    // same problem.
    //
    // Reliable fallback: monkey-patch the global `WebSocket` constructor
    // *once* and wrap any socket whose URL hits our Jitsi WS endpoint.
    // We instrument `socket.send(data)` and intercept `message` events
    // before lib-jitsi-meet's handlers see them, so we capture the
    // actual XMPP bytes regardless of which Strophe internals routed
    // them. Truncate so a noisy ICE candidate / DTLS fingerprint blast
    // doesn't drown the console.
    // TODO(streaming-diag): remove once the CONFERENCE_JOINED-never-fires
    // root cause is identified.
    {
      const w = window as unknown as {
        WebSocket: typeof WebSocket;
        __upstageWsHooked?: boolean;
      };
      if (!w.__upstageWsHooked) {
        const OriginalWebSocket = w.WebSocket;
        const wsHostHint = `${wsScheme}://${host}/xmpp-websocket`;
        const truncate = (s: unknown) => {
          const str = typeof s === "string" ? s : "(non-string frame)";
          return str.length > 800 ? `${str.slice(0, 800)}…(+${str.length - 800})` : str;
        };
        const PatchedWebSocket = function (
          this: WebSocket,
          url: string,
          protocols?: string | string[],
        ) {
          const sock = new OriginalWebSocket(url, protocols);
          // Log EVERY ws creation so we know whether lib-jitsi-meet
          // even reached the WebSocket transport. If we only see MQTT
          // sockets here and no xmpp-websocket, lib-jitsi-meet silently
          // fell back to BOSH/XHR.
          console.log("[diag] WebSocket OPEN", url);
          const isJitsi = typeof url === "string" && url.indexOf("/xmpp-websocket") !== -1;
          if (isJitsi) {
            const origSend = sock.send.bind(sock);
            sock.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
              try {
                console.log("[diag] xmpp ⇒ out", truncate(data));
              } catch (_) {
                /* logging must not break send */
              }
              return origSend(data as never);
            };
            sock.addEventListener("message", (ev: MessageEvent) => {
              try {
                console.log("[diag] xmpp ⇐ in ", truncate(ev.data));
              } catch (_) {
                /* logging must not break recv */
              }
            });
            sock.addEventListener("close", (ev: CloseEvent) => {
              console.warn("[diag] xmpp ws CLOSE", {
                code: ev.code,
                reason: ev.reason,
                wasClean: ev.wasClean,
              });
            });
            sock.addEventListener("error", (ev: Event) => {
              console.warn("[diag] xmpp ws ERROR", ev);
            });
          }
          return sock;
        } as unknown as typeof WebSocket;
        PatchedWebSocket.prototype = OriginalWebSocket.prototype;
        (PatchedWebSocket as any).CONNECTING = OriginalWebSocket.CONNECTING;
        (PatchedWebSocket as any).OPEN = OriginalWebSocket.OPEN;
        (PatchedWebSocket as any).CLOSING = OriginalWebSocket.CLOSING;
        (PatchedWebSocket as any).CLOSED = OriginalWebSocket.CLOSED;
        w.WebSocket = PatchedWebSocket;
        w.__upstageWsHooked = true;
        console.log("[diag] composable WebSocket-wrap installed for", wsHostHint);

        // BOSH fallback tracing. If lib-jitsi-meet didn't open a
        // WebSocket to /xmpp-websocket (because of an internal
        // capability check failure, transport negotiation, or because
        // it deliberately preferred BOSH), every XMPP stanza goes over
        // HTTPS POSTs to `/http-bind` instead. Hook XMLHttpRequest so
        // we still capture the protocol-level conversation.
        const wXhr = window as unknown as { __upstageXhrHooked?: boolean };
        if (!wXhr.__upstageXhrHooked) {
          const OriginalOpen = XMLHttpRequest.prototype.open;
          const OriginalSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.open = function (
            method: string,
            url: string | URL,
            ...rest: unknown[]
          ) {
            (this as unknown as { __upstageUrl?: string }).__upstageUrl = String(url);

            return OriginalOpen.apply(this, arguments as any);
          };
          XMLHttpRequest.prototype.send = function (
            body?: Document | XMLHttpRequestBodyInit | null,
          ) {
            const url = (this as unknown as { __upstageUrl?: string }).__upstageUrl ?? "";
            const isBosh = url.indexOf("/http-bind") !== -1;
            if (isBosh) {
              try {
                console.log("[diag] bosh ⇒ out", truncate(body as unknown));
              } catch (_) {
                /* logging must not break send */
              }
              this.addEventListener("load", () => {
                try {
                  console.log(
                    "[diag] bosh ⇐ in ",
                    "status=" + this.status,
                    truncate(this.responseText),
                  );
                } catch (_) {
                  /* logging must not break recv */
                }
              });
              this.addEventListener("error", (ev: Event) => {
                console.warn("[diag] bosh xhr ERROR", { status: this.status, ev });
              });
            }

            return OriginalSend.apply(this, arguments as any);
          };
          wXhr.__upstageXhrHooked = true;
          console.log("[diag] composable XHR-wrap installed for /http-bind");
        }
      }
    }

    target.connection.addEventListener(
      JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
      (e) => {
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
        console.log("[diag] composable initJitsiConference", {
          stageUrl,
          stageUrlType: typeof stageUrl,
          stageUrlEmpty: !stageUrl,
        });
        try {
          // The second arg is the conference *config* object and is REQUIRED:
          // this bundle's `JitsiConference._init` dereferences `config.statisticsId`,
          // so passing no options throws "Cannot read properties of undefined".
          // NOTE: this bundle does NOT read an `openBridgeChannel` option here
          // (grep: 0 hits) — bridge transport is chosen in `_setBridgeChannel`.
          //
          // `p2p.enabled: false` is REQUIRED for an UpStage stage. This room is a
          // one-to-many broadcast (one performer, many viewers), not a 2-party
          // call. With P2P on (the lib default), as soon as the conference has
          // exactly two participants Jitsi pairs them peer-to-peer and SUSPENDS
          // the performer's JVB media ("Suspending media transfer over the JVB
          // connection"). The viewer who happened to be present at that moment
          // sees the stream over P2P, but the JVB copy the bridge forwards is
          // dropped ("add remote JVB track, when in P2P - IGNORED"), so any
          // viewer who joins LATER (becoming a 3rd participant while P2P stays
          // pinned to the first pair) receives nothing. Forcing every session
          // through the JVB SFU makes late and early joiners behave identically.
          // Meetings ride the same room and are unaffected functionally — a
          // 2-party meeting simply routes through the bridge instead of P2P.
          target.room = target.connection.initJitsiConference(stageUrl, {
            p2p: { enabled: false },
          });
        } catch (initErr) {
          console.error("[diag] composable initJitsiConference threw", initErr);
          return;
        }
        target.room.on(JitsiMeetJS.events.conference.DATA_CHANNEL_OPENED, () => {
          console.log("[diag] composable DATA_CHANNEL_OPENED (bridge channel up)");
        });
        target.room.on(JitsiMeetJS.events.conference.TRACK_ADDED, (track) => {
          console.log("[diag] composable TRACK_ADDED", {
            type: track?.type,
            participantId: track?.getParticipantId?.(),
            trackId: track?.getId?.(),
            isLocal: track?.isLocal?.(),
          });
          stageStore.addTrack(track, serverTag);
        });
        target.room.on(JitsiMeetJS.events.conference.TRACK_REMOVED, (track) => {
          console.log("[diag] composable TRACK_REMOVED", {
            type: track?.type,
            participantId: track?.getParticipantId?.(),
          });
          if (track) stageStore.removeTrack(track);
        });
        target.room.on(JitsiMeetJS.events.conference.USER_JOINED, (id) => {
          console.log("[diag] composable USER_JOINED", id);
        });
        target.room.on(JitsiMeetJS.events.conference.USER_LEFT, (id) => {
          console.log("[diag] composable USER_LEFT", id);
          if (id != null) stageStore.removeJitsiParticipantLocally(String(id), serverTag);
        });
        target.room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, (e) => {
          console.log("[diag] composable CONFERENCE_JOINED", {
            myUserId: target.room?.myUserId?.(),
            e,
          });
          const myId = target.room?.myUserId?.();
          // Only the active publish session heals own tiles / owns the shared
          // `joined`. A switch target does this explicitly once swapped in;
          // viewer sessions never own tiles on their server.
          if (myId != null && session.isActive()) {
            stageStore.syncLocalJitsiParticipantId(String(myId), serverTag);
          }
          markJoined(true);

          // Bridge-channel / ICE probe (independent of lib log level).
          // The audience-no-video bug is "TRACK_ADDED + attach() succeed but
          // videoWidth stays 0". The two frontend-visible causes are:
          //   (a) the JVB peerconnection ICE never reaches connected/completed
          //       => no media of any kind flows (audio would be dead too); or
          //   (b) ICE is fine but the Colibri bridge channel never opens
          //       => JVB forwards no video (audio still flows).
          // Poll the raw RTCPeerConnection + bridge channel a few times so the
          // next live test states which one it is, without inferring.
          const probe = (afterMs: number) => {
            setTimeout(() => {
              try {
                const room: any = target.room;
                const jvbPc = room?.jvbJingleSession?.peerconnection;
                const rawPc = jvbPc?.peerconnection;
                const rtc: any = room?.rtc;
                // BridgeChannel manager stores the active channel on `_channel`.
                const ch = rtc?._channel?._channel;
                // Per-remote-participant advertised media sources. With
                // sourceNameSignaling, a publisher announces its source in MUC
                // presence; if a remote participant shows a video source here but
                // no track arrives, JVB is withholding (subscribe-side). If it
                // shows NO source, the publisher isn't announcing media at all
                // (publish-side). getSources() returns a Map(mediaType -> Set).
                const participants = (room?.getParticipants?.() || []).map((p) => {
                  let sources = null;
                  try {
                    const m = p.getSources?.();
                    if (m && typeof m.forEach === "function") {
                      sources = {};
                      m.forEach((set, mediaType) => {
                        sources[mediaType] = [...(set?.keys?.() || [])];
                      });
                    }
                  } catch (_) {
                    sources = "throw";
                  }
                  return {
                    id: p.getId?.(),
                    displayName: p.getDisplayName?.(),
                    // muted/videoType distinguish "camera off / not sending"
                    // (publish-side) from "JVB withholding live media".
                    tracks: (p.getTracks?.() || []).map((t) => ({
                      type: t.getType?.(),
                      muted: t.isMuted?.(),
                      videoType: t.getVideoType?.(),
                      ssrc: t.getSSRC?.(),
                    })),
                    sources,
                  };
                });
                // Stringify so Playwright/console doesn't truncate the nested
                // participants array in its object preview.
                // LOCAL tracks (publisher side): are we actually sending, and
                // is the camera muted? Empty here on a publisher = addTrack never
                // ran. muted:true on the video = camera off / not sending RTP.
                const localTracks = (room?.getLocalTracks?.() || []).map((t) => ({
                  type: t.getType?.(),
                  muted: t.isMuted?.(),
                  videoType: t.getVideoType?.(),
                  ended: t.isEnded?.(),
                  ssrc: t.getSSRC?.(),
                }));
                console.log(
                  `[diag] composable BRIDGE/ICE probe @${afterMs}ms ` +
                    JSON.stringify({
                      iceConnectionState: rawPc?.iceConnectionState ?? null,
                      connectionState: rawPc?.connectionState ?? null,
                      hasJvbSession: !!room?.jvbJingleSession,
                      isP2PActive: room?.isP2PActive?.() ?? null,
                      localTrackCount: localTracks.length,
                      localTracks,
                      // bridge channel: WebSocket readyState 0..3; RTCDataChannel
                      // readyState "connecting|open|closing|closed".
                      bridgeChannelType: ch ? ch.constructor?.name : null,
                      bridgeChannelReadyState: ch?.readyState ?? null,
                      lastN: room?.getLastN?.() ?? null,
                      participantCount: participants.length,
                      participants,
                    }),
                );
              } catch (probeErr) {
                console.warn("[diag] composable BRIDGE/ICE probe threw", probeErr);
              }
            }, afterMs);
          };
          probe(3000);
          probe(10000);
          probe(20000);
        });
        target.room.on(JitsiMeetJS.events.conference.CONFERENCE_FAILED, (...args) => {
          console.warn("[diag] composable CONFERENCE_FAILED", ...args);
        });

        try {
          console.log("[diag] composable room.join() about to call", {
            myUserIdBeforeJoin: target.room?.myUserId?.(),
          });
          target.room.join();
          console.log("[diag] composable room.join() returned");
        } catch (joinErr) {
          console.error("[diag] composable room.join() threw", joinErr);
        }
        // Watchdog: dump a verbose snapshot at 5s/15s/30s so we can see
        // whether the MUC join progresses, stays totally silent, or
        // surfaces a late presence-error. ALSO confirms the WebSocket
        // patch is wired (window.WebSocket.name should be "PatchedWebSocket"
        // and __upstageWsHooked=true) — if it isn't, the "no [diag] xmpp"
        // lines aren't evidence of a server-side hang but of a patch
        // installation race.
        // TODO(streaming-diag): remove once root cause identified.
        const watchdog = (afterMs: number) => {
          setTimeout(() => {
            if (session.joined.value) return;
            const r = target.room;
            const xmppConn = target.connection?.xmpp?.connection;
            let members: unknown;
            try {
              members = r?.getParticipants?.()?.length;
            } catch (_) {
              members = "throw";
            }
            let role: unknown;
            try {
              role = r?.getRole?.();
            } catch (_) {
              role = "throw";
            }
            const w = window as unknown as {
              WebSocket: typeof WebSocket;
              __upstageWsHooked?: boolean;
            };
            console.error(`[diag] composable JOIN_WATCHDOG joined=false after ${afterMs}ms`, {
              hasRoom: !!r,
              myUserId: r?.myUserId?.(),
              myroomjid: r?.myroomjid,
              roomjid: r?.roomjid,
              members,
              role,
              isJoined: r?.isJoined?.(),
              isFocus: r?.focusFeatureDiscoveryComplete,
              xmpp: {
                connected: xmppConn?.connected,
                authenticated: xmppConn?.authenticated,
                jid: xmppConn?.jid,
                transport: xmppConn?._proto?.constructor?.name,
                wsUrl: xmppConn?._proto?._wsUrl,
                boshUrl: xmppConn?._proto?._url,
                disconnecting: xmppConn?.disconnecting,
                do_authentication: xmppConn?.do_authentication,
              },
              patch: {
                wsHooked: !!w.__upstageWsHooked,
                wsConstructorName:
                  typeof w.WebSocket === "function" ? w.WebSocket.name : typeof w.WebSocket,
              },
            });
          }, afterMs);
        };
        watchdog(5_000);
        watchdog(15_000);
        watchdog(30_000);

        // One-shot raw XMPP tap on Strophe itself. Earlier `rawInput` /
        // `rawOutput` attempts failed because they were set BEFORE the
        // Strophe connection existed; by the time CONNECTION_ESTABLISHED
        // fires the connection IS there, so wiring them here catches
        // every inbound stanza (including any MUC presence-error that
        // would explain a silent join hang). Outbound `rawOutput` was
        // documented as unreliable for the WebSocket transport, so we
        // still keep the global WebSocket wrap as the canonical outbound
        // capture. Defensive: lib could reorganise this internal path
        // between releases, so wrap in try/catch.
        // TODO(streaming-diag): remove with the rest of the trace.
        try {
          const xmppConn = target.connection?.xmpp?.connection;
          if (xmppConn && typeof xmppConn.xmlInput !== "function") {
            xmppConn.xmlInput = (elem: { outerHTML?: string }) => {
              try {
                const s = elem?.outerHTML ?? String(elem);
                console.log(
                  "[diag] strophe xmlInput",
                  s.length > 800 ? `${s.slice(0, 800)}…(+${s.length - 800})` : s,
                );
              } catch (_) {
                /* swallow */
              }
            };
          }
          if (xmppConn && typeof xmppConn.xmlOutput !== "function") {
            xmppConn.xmlOutput = (elem: { outerHTML?: string }) => {
              try {
                const s = elem?.outerHTML ?? String(elem);
                console.log(
                  "[diag] strophe xmlOutput",
                  s.length > 800 ? `${s.slice(0, 800)}…(+${s.length - 800})` : s,
                );
              } catch (_) {
                /* swallow */
              }
            };
          }
          console.log("[diag] strophe xmlInput/xmlOutput hooks installed", {
            hasXmppConn: !!xmppConn,
          });
        } catch (hookErr) {
          console.warn("[diag] failed to install strophe xmlInput/xmlOutput", hookErr);
        }
      },
    );
    target.connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_FAILED, (e) => {
      console.error("Connection failed", e);
      markJoined(false);
      if (session.isActive()) stageStore.syncLocalJitsiParticipantId(null);
    });
    target.connection.addEventListener(
      JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
      (e) => {
        console.error("Connection disconnected", e);
        markJoined(false);
        if (session.isActive()) stageStore.syncLocalJitsiParticipantId(null);
      },
    );

    // Sanity log right before connect(): confirms our WebSocket wrap
    // is in place at the moment Strophe is about to dial out. If
    // `wsConstructorName` is anything other than "PatchedWebSocket"
    // (e.g. native "WebSocket"), the patch race is the reason we're
    // not seeing [diag] xmpp lines, NOT a server hang.
    // TODO(streaming-diag): remove with the rest of the trace.
    {
      const w = window as unknown as { WebSocket: typeof WebSocket; __upstageWsHooked?: boolean };
      console.log("[diag] composable about to connect()", {
        wsHooked: !!w.__upstageWsHooked,
        wsConstructorName:
          typeof w.WebSocket === "function" ? w.WebSocket.name : typeof w.WebSocket,
      });
    }
    target.connection.connect();
  };

  // Which server this tab should publish to. Single-server builds always
  // get entry 0 (identical to before). Otherwise: an own tile already on the
  // board (navigate-away/back keeps the performer where they were) → the
  // stage's default from Studio > Customisation → entry 0.
  const pickInitialOrigin = () => {
    if (!multiServer) return configs.JITSI_ENDPOINT;
    const mySession = stageStore.session;
    const own = (stageStore.board?.objects ?? []).find(
      (o) =>
        isJitsiBoardType(o.type) &&
        mySession != null &&
        o.hostId === mySession &&
        typeof o.jitsiServer === "string" &&
        jitsiServers.includes(o.jitsiServer),
    );
    if (own) return own.jitsiServer;
    const stageDefault = stageStore.config?.jitsiServer;
    if (typeof stageDefault === "string" && jitsiServers.includes(stageDefault)) {
      return stageDefault;
    }
    return configs.JITSI_ENDPOINT;
  };

  const startConnection = (stageUrl: string) => {
    currentStageUrl = stageUrl;
    const origin = pickInitialOrigin();
    server.value = origin;
    const session = createJitsiSession({ origin, stageUrl, target: jitsi, initLib: true });
    activeSession = session;
    if (multiServer) syncViewerSessions();
  };

  // ------------------------------------------------------------------
  // Viewer sessions (multi-server only). Every origin that has a live tile
  // on the board and is not our publish server gets a receive-only session
  // so its performers' tracks reach this browser. An origin that drops off
  // the board is left after a grace period (a performer re-placing a tile
  // must not churn the connection).
  const VIEWER_LEAVE_GRACE_MS = 30_000;
  const viewerLeaveTimers = new Map();

  const syncViewerSessions = () => {
    if (!multiServer || !currentStageUrl) return;
    const inUse = new Set(stageStore.jitsiServersInUse ?? []);
    for (const origin of inUse) {
      if (origin === server.value || !jitsiServers.includes(origin)) continue;
      const pendingLeave = viewerLeaveTimers.get(origin);
      if (pendingLeave) {
        clearTimeout(pendingLeave);
        viewerLeaveTimers.delete(origin);
      }
      if (viewerSessions.has(origin)) continue;
      console.log("[diag] useJitsi: opening viewer session", { origin });
      const session = createJitsiSession({
        origin,
        stageUrl: currentStageUrl,
        target: { room: null, connection: null },
        initLib: false,
      });
      viewerSessions.set(origin, session);
    }
    for (const [origin, session] of viewerSessions) {
      if (inUse.has(origin) || viewerLeaveTimers.has(origin)) continue;
      viewerLeaveTimers.set(
        origin,
        setTimeout(() => {
          viewerLeaveTimers.delete(origin);
          if ((stageStore.jitsiServersInUse ?? []).includes(origin)) return;
          console.log("[diag] useJitsi: closing idle viewer session", { origin });
          viewerSessions.delete(origin);
          session.leave();
        }, VIEWER_LEAVE_GRACE_MS),
      );
    }
  };

  if (multiServer) {
    // Join on the sorted string so the handler only runs on real changes,
    // not on every board mutation that re-creates the array.
    watch(
      () => (stageStore.jitsiServersInUse ?? []).join("|"),
      () => syncViewerSessions(),
    );
  }

  // ------------------------------------------------------------------
  // Performer switches server mid-show. Order matters (see plan §4.6):
  // join the NEW server first, heal own tiles to the new participantId +
  // server (so the audience keeps the tile and moves its media source),
  // and only then leave the old server — a viewer's USER_LEFT from the old
  // server would otherwise delete the tile before the heal arrives.
  const SWITCH_JOIN_TIMEOUT_MS = 20_000;

  const waitForJoin = (session) =>
    new Promise((resolve) => {
      if (session.joined.value) return resolve(true);
      let stop = () => {};
      const timer = setTimeout(() => {
        stop();
        resolve(false);
      }, SWITCH_JOIN_TIMEOUT_MS);
      stop = watch(session.joined, (v) => {
        if (v) {
          clearTimeout(timer);
          stop();
          resolve(true);
        }
      });
    });

  const switchServer = async (next: string): Promise<boolean> => {
    if (!multiServer || switching.value) return false;
    if (!next || next === server.value || !jitsiServers.includes(next)) return false;
    if (!currentStageUrl || !activeSession) return false;
    switching.value = true;
    const previous = activeSession;
    const previousOrigin = server.value;
    try {
      // 1. Join the new server (inactive until it is joined).
      const target = { room: null, connection: null };
      const candidate = createJitsiSession({
        origin: next,
        stageUrl: currentStageUrl,
        target,
        initLib: false,
      });
      const ok = await waitForJoin(candidate);
      if (!ok) {
        console.warn("[diag] useJitsi: switchServer join timed out; staying on", previousOrigin);
        candidate.leave();
        return false;
      }
      // 2. Stop sending to the old room (tracks + camera stay alive).
      await jitsi.unpublishForSwap?.();
      // 3. Swap in place; pulse `joined` so the publisher's watcher fires.
      activeSession = candidate;
      jitsi.room = target.room;
      jitsi.connection = target.connection;
      server.value = next;
      joined.value = false;
      await nextTick();
      // 4. Heal own tiles → new participantId + server (broadcast to viewers).
      const myId = target.room?.myUserId?.();
      if (myId != null) stageStore.syncLocalJitsiParticipantId(String(myId), next);
      joined.value = true;
      // 5. Old session: keep it as a viewer session while other tiles still
      //    use that server, else drop it.
      const stillUsed = (stageStore.jitsiServersInUse ?? []).includes(previousOrigin);
      if (stillUsed && !viewerSessions.has(previousOrigin)) {
        viewerSessions.set(previousOrigin, previous);
      } else {
        previous.leave();
      }
      // The new publish origin may have had a viewer session — it is now
      // redundant (same conference).
      const duplicate = viewerSessions.get(next);
      if (duplicate) {
        viewerSessions.delete(next);
        duplicate.leave();
      }
      syncViewerSessions();
      console.log("[diag] useJitsi: switched publish server", { from: previousOrigin, to: next });
      return true;
    } finally {
      switching.value = false;
    }
  };
  jitsi.switchServer = switchServer;

  // One-shot watcher: as soon as `stageStore.url` reports a real stage
  // (anything other than the empty placeholder), kick off the conference
  // connect with the *resolved* URL. The watcher self-stops after the
  // first non-placeholder value so a transient model refresh can't tear
  // down and re-create the conference mid-session.
  onMounted(() => {
    const initialUrl = stageStore.url;
    if (!isPlaceholderStageUrl(initialUrl)) {
      startConnection(String(initialUrl));
      return;
    }
    const stop = watch(
      () => stageStore.url,
      (url) => {
        if (isPlaceholderStageUrl(url)) return;
        stop();
        startConnection(String(url));
      },
    );
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
    // Multi-server: viewer sessions and any pending idle-leave timers.
    for (const timer of viewerLeaveTimers.values()) clearTimeout(timer);
    viewerLeaveTimers.clear();
    for (const session of viewerSessions.values()) session.leave();
    viewerSessions.clear();
    activeSession = null;
    joined.value = false;
    stageStore.syncLocalJitsiParticipantId(null);
  });

  return [jitsi, joined];
};
