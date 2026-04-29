import type { JQueryStatic } from "jquery";

/**
 * Ambient declarations for legacy global scripts injected from `index.html`.
 *
 * - `JitsiMeetExternalAPI` ships from `https://meet.jit.si/external_api.min.js`
 *   and provides the iframe-based meeting embed.
 * - `JitsiMeetJS` ships from `/js/jitsi/lib-jitsi-meet.min.js` and exposes the
 *   low-level XMPP/RTC primitives used in `services/jitsi` (and expects a global
 *   jQuery — we assign it from `src/main.ts`).
 * - `meSpeak` ships from `/js/mespeak/mespeak.js` and powers avatar speech.
 */
declare global {
  interface Window {
    /** Dev-only hook for Playwright E2E (`pnpm dev`). Do not rely on in production. */
    __UPSTAGE_STORE__?: import("vuex").Store<unknown>;
    $: JQueryStatic;
    jQuery: JQueryStatic;
    JitsiMeetExternalAPI: JitsiMeetExternalAPIConstructor;
    JitsiMeetJS: JitsiMeetJSStatic;
    meSpeak: MeSpeak;
  }

  type JitsiMeetExternalAPIConstructor = new (
    domain: string,
    options: Record<string, unknown>,
  ) => JitsiMeetExternalAPIInstance;

  interface JitsiMeetExternalAPIInstance {
    addEventListener(event: string, listener: (...args: unknown[]) => void): void;
    removeEventListener(event: string, listener: (...args: unknown[]) => void): void;
    executeCommand(command: string, ...args: unknown[]): void;
    dispose(): void;
  }

  interface JitsiMeetJSStatic {
    init(options?: Record<string, unknown>): void;
    setLogLevel(level: string): void;
    JitsiConnection: new (
      appId: string | null,
      token: string | null,
      options: Record<string, unknown>,
    ) => JitsiConnection;
    events: Record<string, Record<string, string>>;
    errors: Record<string, Record<string, string>>;
    logLevels: Record<string, string>;
    createLocalTracks(options: Record<string, unknown>): Promise<JitsiLocalTrack[]>;
  }

  interface JitsiConnection {
    addEventListener(event: string, listener: (...args: unknown[]) => void): void;
    removeEventListener(event: string, listener: (...args: unknown[]) => void): void;
    connect(): void;
    disconnect(): void;
    initJitsiConference(name: string, options: Record<string, unknown>): JitsiConference;
  }

  interface JitsiConference {
    addEventListener(event: string, listener: (...args: unknown[]) => void): void;
    removeEventListener(event: string, listener: (...args: unknown[]) => void): void;
    join(password?: string): void;
    leave(): Promise<void>;
    addTrack(track: JitsiLocalTrack): Promise<void>;
    removeTrack(track: JitsiLocalTrack): Promise<void>;
    setDisplayName(name: string): void;
  }

  interface JitsiLocalTrack {
    getType(): "audio" | "video";
    dispose(): Promise<void>;
    attach(element: HTMLElement): void;
    detach(element?: HTMLElement): void;
    isMuted(): boolean;
    mute(): Promise<void>;
    unmute(): Promise<void>;
  }

  interface MeSpeak {
    loadConfig(url: string, callback?: (success: boolean) => void): void;
    loadVoice(url: string, callback?: (success: boolean) => void): void;
    speak(
      text: string,
      options?: {
        amplitude?: number;
        wordgap?: number;
        pitch?: number;
        speed?: number;
        variant?: string;
        voice?: string;
        rawdata?: string;
      },
      callback?: (success: boolean) => void,
    ): number;
    stop(handleId?: number): void;
    isVoiceLoaded(voice: string): boolean;
  }
}

export {};
