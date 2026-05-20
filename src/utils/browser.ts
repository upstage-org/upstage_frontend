/**
 * Browser / engine detection for WebKit-specific behaviour.
 *
 * All browsers on iOS / iPadOS use WebKit (App Store policy), so iOS
 * detection doubles as "mobile WebKit" for media-volume and touch quirks.
 */

/** @see `isIOS` in the former `common.ts` — re-exported from here. */
export const isIOS = (): boolean => {
  if (typeof navigator === "undefined") return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
};

/**
 * Desktop Safari (macOS). Excludes Chrome, Firefox, Edge, and other
 * Chromium/Firefox shells that embed WebKit on iOS but report a
 * non-Safari UA on desktop.
 */
export const isSafari = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iOS browsers are WebKit but not "Safari" in the desktop sense.
  if (isIOS()) return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  const isWebKitEngine = /AppleWebKit/i.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/i.test(ua);
  return isWebKitEngine && /Safari/i.test(ua);
};

/** Any WebKit engine (desktop Safari, iOS Safari, and all iOS browsers). */
export const isWebKit = (): boolean => {
  if (typeof navigator === "undefined") return false;
  if (isIOS()) return true;
  return /AppleWebKit/i.test(navigator.userAgent);
};
