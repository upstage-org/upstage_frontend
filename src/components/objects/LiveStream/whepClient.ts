/**
 * Minimal WHEP (WebRTC-HTTP Egress Protocol) client for playing MediaMTX
 * live streams — the RTMP feed playback path (see /root/streaming2).
 *
 * No library: a WHEP read session is one RTCPeerConnection, one POST of the
 * SDP offer (201 + Location + answer SDP), and one DELETE on teardown.
 * MediaMTX accepts non-trickle offers, so we wait for ICE gathering to
 * finish (bounded) and send a complete offer instead of PATCHing candidates.
 */
import configs from "config";

/** The feed exists but nobody is publishing right now (MediaMTX responds 404). */
export class StreamOfflineError extends Error {
  constructor(key: string) {
    super(`Stream "${key}" is not live`);
    this.name = "StreamOfflineError";
  }
}

export interface WhepConnection {
  /** Remote A/V; assign to `video.srcObject`. Tracks may arrive after resolve. */
  stream: MediaStream;
  pc: RTCPeerConnection;
  /**
   * Whether the WHEP answer accepted our audio m-line. False when the feed's
   * audio codec can't ride WebRTC — RTMP encoders (OBS etc.) send AAC, which
   * WebRTC doesn't support and MediaMTX doesn't transcode, so such feeds are
   * video-only over WHEP even though HLS carries their sound fine.
   */
  hasAudio: boolean;
  /** Tear down the WHEP session (DELETE) and close the peer connection. */
  close: () => Promise<void>;
}

export function whepEndpointForKey(key: string): string {
  return `${configs.RTMP_ENDPOINT}/live/${encodeURIComponent(key)}/whep`;
}

/**
 * MediaMTX mirrors each feed to `live/<key>-opus` with the audio transcoded
 * AAC→Opus (see /root/streaming2/mediamtx.yml runOnReady) — the
 * WebRTC-playable twin of the raw feed, since WebRTC can't carry the AAC
 * that RTMP encoders send. WHEP playback prefers the mirror; the raw feed
 * and HLS remain as fallbacks for the mirror's warm-up window or a server
 * without the transcoder.
 */
export function opusMirrorKey(key: string): string {
  return `${key}-opus`;
}

export function hlsUrlForKey(key: string): string {
  return `${configs.RTMP_ENDPOINT}/live/${encodeURIComponent(key)}/index.m3u8`;
}

/**
 * Whether the feed's HLS multivariant playlist advertises an audio codec
 * (CODECS="...,mp4a.40.2" for the AAC that RTMP encoders send). Used to
 * decide if a WHEP session that came up video-only dropped real audio
 * (→ worth falling back to HLS) or the source simply has no sound.
 * Best-effort: any fetch/parse failure reads as "no audio detected".
 */
export async function hlsStreamHasAudio(key: string): Promise<boolean> {
  try {
    const response = await fetch(hlsUrlForKey(key));
    if (!response.ok) return false;
    const manifest = await response.text();
    return /mp4a|opus|ac-3|ec-3/i.test(manifest);
  } catch {
    return false;
  }
}

const ICE_GATHER_TIMEOUT_MS = 1500;

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(finish, ICE_GATHER_TIMEOUT_MS);
    function finish() {
      window.clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }
    function check() {
      if (pc.iceGatheringState === "complete") finish();
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

export async function connectWhep(key: string): Promise<WhepConnection> {
  const endpoint = whepEndpointForKey(key);
  const pc = new RTCPeerConnection();
  const stream = new MediaStream();

  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  pc.addEventListener("track", (event) => {
    if (!stream.getTracks().some((t) => t.id === event.track.id)) {
      stream.addTrack(event.track);
    }
  });

  let sessionUrl: string | null = null;
  const close = async () => {
    if (sessionUrl) {
      const url = sessionUrl;
      sessionUrl = null;
      try {
        await fetch(url, { method: "DELETE" });
      } catch {
        // Best effort — MediaMTX also reaps sessions on ICE disconnect.
      }
    }
    try {
      pc.close();
    } catch {
      /* already closed */
    }
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription?.sdp ?? offer.sdp,
    });
    if (response.status === 404) {
      throw new StreamOfflineError(key);
    }
    if (!response.ok) {
      throw new Error(`WHEP request failed: ${response.status}`);
    }

    const location = response.headers.get("Location");
    if (location) {
      sessionUrl = new URL(location, endpoint).toString();
    }

    const answer = await response.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
  } catch (error) {
    await close();
    throw error;
  }

  // After the answer is applied, a rejected audio m-line leaves its
  // transceiver "inactive"; an accepted one is "recvonly" (we offered
  // recvonly, so no other active state is possible).
  const hasAudio = pc
    .getTransceivers()
    .some((t) => t.receiver.track?.kind === "audio" && t.currentDirection === "recvonly");

  return { stream, pc, hasAudio, close };
}
