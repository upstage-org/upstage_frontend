// @ts-nocheck
import configs from "config";
import { SharedAuth } from "models/config";
import { User as LegacyUser } from "models/studio";
import { message } from "ant-design-vue";

export function absolutePath(path: string) {
  return `${configs.STATIC_ASSETS_ENDPOINT}${path}`;
}

/**
 * JPEG poster path for uploaded VoD (`file.mp4` → `file.mp4.poster.jpg`).
 * Inserts before `?` / `#` so signed or cache-busted URLs keep the same query
 * string (and avoids broken paths like `file.mp4?sig=x.poster.jpg`).
 */
export function posterJpgForVideoUrl(url: string): string {
  if (!url || typeof url !== "string") return "";
  const u = url.trim();
  if (!u) return "";
  const hashIdx = u.indexOf("#");
  const beforeHash = hashIdx >= 0 ? u.slice(0, hashIdx) : u;
  const frag = hashIdx >= 0 ? u.slice(hashIdx) : "";
  const qIdx = beforeHash.indexOf("?");
  const pathOnly = qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash;
  const query = qIdx >= 0 ? beforeHash.slice(qIdx) : "";
  return `${pathOnly}.poster.jpg${query}${frag}`;
}

/**
 * Toolbox / GraphQL asset labels that map onto the Streams strip and play back
 * as `BoardObject.type === "video"` with `object.url` (synonyms are lowercase
 * in SET_MODEL except when `assetType.name` overrides with e.g. "Video").
 */
const STREAM_PLAYBACK_TYPE_ALIASES = new Set(["video", "stream", "streams", "streaming"]);

export function isStreamPlaybackBoardType(type: unknown): boolean {
  if (type == null) return false;
  return STREAM_PLAYBACK_TYPE_ALIASES.has(String(type).trim().toLowerCase());
}

/** GraphQL `assetType.name` may be `Jitsi`; board resolution uses key `jitsi` only. */
const JITSI_BOARD_TYPE_ALIASES = new Set(["jitsi"]);

export function isJitsiBoardType(type: unknown): boolean {
  if (type == null) return false;
  return JITSI_BOARD_TYPE_ALIASES.has(String(type).trim().toLowerCase());
}

// `upstage-auth` is the key written by `pinia-plugin-persistedstate` for the
// Pinia auth store (see `src/store/pinia/auth.ts`). After the Phase 5 cutover
// from Vuex this is the single source of truth for the persisted access /
// refresh tokens; the old `vuex` key (vuex-persistedstate, paths: ['auth'])
// is gone.
//
// Both helpers read AND fall back to the legacy `vuex` key so a stale tab
// (held open across a redeploy) still hands a token to Apollo for one final
// refresh cycle, then the Pinia store will repersist under the new key on
// the next setSharedAuth call.
const AUTH_STORAGE_KEY = "upstage-auth";
const LEGACY_AUTH_STORAGE_KEY = "vuex";

export function getSharedAuth(): SharedAuth | undefined {
  try {
    const piniaJSON = localStorage.getItem(AUTH_STORAGE_KEY);
    if (piniaJSON) {
      const parsed = JSON.parse(piniaJSON);
      // pinia-plugin-persistedstate writes the picked fields at the top level.
      if (parsed && typeof parsed === "object") {
        return parsed as SharedAuth;
      }
    }
    const legacyJSON = localStorage.getItem(LEGACY_AUTH_STORAGE_KEY);
    if (legacyJSON) {
      const sharedState = JSON.parse(legacyJSON);
      return sharedState?.auth;
    }
  } catch {
    console.log("No shared auth found. Try login using dashboard first!");
  }
  return undefined;
}

export function setSharedAuth(auth: SharedAuth) {
  const existing = (() => {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Partial<SharedAuth>) : {};
    } catch {
      return {};
    }
  })();
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...existing, ...auth }));
}

export function humanFileSize(bytes: number, si = false, dp = 1) {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + " B";
  }

  const units = ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);

  return bytes.toFixed(dp) + " " + units[u];
}

export function capitalize(str: string) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

export function titleCase(str: string) {
  if (!str) {
    return "";
  }
  var splitStr = str.toLowerCase().replace(/_/g, " ").split(" ");
  for (var i = 0; i < splitStr.length; i++) {
    splitStr[i] = splitStr[i].charAt(0).toUpperCase() + splitStr[i].substring(1);
  }
  return splitStr.join(" ");
}

export function displayName(
  user: Pick<any | LegacyUser, "displayName" | "firstName" | "lastName" | "username">,
) {
  if (!user) return "";
  if (user.displayName?.trim()) return user.displayName;
  if (user.firstName || user.lastName)
    return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return user.username;
}

export function debounce(callback: TimerHandler, delay: number) {
  let timeout: number;
  return () => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(callback, delay);
  };
}

export function includesIgnoreCase(value: string, keyword: string) {
  return value.toLowerCase().includes(keyword.toLowerCase());
}

export const isJson = (d: any) => {
  try {
    JSON.parse(d);
  } catch {
    return false;
  }
  return true;
};

export const displayTimestamp = (t: number) => {
  let s: any = Math.round(t);
  let m: any = Math.floor(s / 60);
  s = String(s % 60).padStart(2, "0");
  if (m < 60) {
    return `${m}:${s}`;
  }
  let h = Math.floor(m / 60);
  m = String(m % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

export function cloneDeep(object: any) {
  return JSON.parse(JSON.stringify(object));
}

export const randomColor = () => {
  var letters = "0123456789ABCDEF";
  var color = "#";
  for (var i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
};

export const padZero = (str: string, len = 2) => {
  len = len || 2;
  var zeros = new Array(len).join("0");
  return (zeros + str).slice(-len);
};

export const invertColor = (hex: string, bw: boolean) => {
  if (hex.indexOf("#") === 0) {
    hex = hex.slice(1);
  }
  // convert 3-digit hex to 6-digits.
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (hex.length !== 6) {
    throw new Error("Invalid HEX color.");
  }
  var r: any = parseInt(hex.slice(0, 2), 16),
    g: any = parseInt(hex.slice(2, 4), 16),
    b: any = parseInt(hex.slice(4, 6), 16);
  if (bw) {
    // http://stackoverflow.com/a/3943023/112731
    return r * 0.299 + g * 0.587 + b * 0.114 > 186 ? "#000000" : "#FFFFFF";
  }
  // invert color components
  r = (255 - r).toString(16);
  g = (255 - g).toString(16);
  b = (255 - b).toString(16);
  // pad each with zeros and return
  return "#" + padZero(r) + padZero(g) + padZero(b);
};

export const randomMessageColor = () => {
  const bg = randomColor();
  const text = invertColor(bg, true);
  return { text, bg };
};

export const randomRange = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1) + min);

export function linkify(inputText: string) {
  var replacedText, replacePattern1, replacePattern2, replacePattern3;

  //URLs starting with http://, https://, or ftp://
  replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/gim;
  replacedText = inputText.replace(replacePattern1, '<a href="$1" target="_blank">$1</a>');

  //URLs starting with "www." (without // before it, or it'd re-link the ones done above).
  replacePattern2 = /(^|[^/])(www\.[\S]+(\b|$))/gim;
  replacedText = replacedText.replace(
    replacePattern2,
    '$1<a href="http://$2" target="_blank">$2</a>',
  );

  //Change email addresses to mailto:: links.
  replacePattern3 = /(([a-zA-Z0-9\-_.])+@[a-zA-Z_]+?(\.[a-zA-Z]{2,6})+)/gim;
  replacedText = replacedText.replace(replacePattern3, '<a href="mailto:$1">$1</a>');

  return replacedText;
}

export function outOfViewportPosition(el) {
  const rect = el.getBoundingClientRect();
  if (rect.top < 0) {
    return "top";
  }
  if (rect.left < 0) {
    return "left";
  }
  if (rect.bottom > (window.innerHeight || document.documentElement.clientHeight)) {
    return "bottom";
  }
  if (rect.right > (window.innerWidth || document.documentElement.clientWidth)) {
    return "right";
  }
  return false;
}
export function throttle(callback, limit) {
  let wait = false;
  return function (...args) {
    if (!wait) {
      callback.call(this, ...args);
      wait = true;
      setTimeout(function () {
        wait = false;
      }, limit);
    }
  };
}

export { isIOS, isSafari, isWebKit } from "@utils/browser";

/**
 * Cross-browser number-input coercion.
 *
 * `<input type="number">` is one of the surfaces where browsers diverge:
 *  - Chromium silently rejects most non-numeric typed input, leaving
 *    `event.target.value` as the empty string.
 *  - Firefox accepts looser input (e.g. trailing letters or alternative
 *    decimal separators in some locales) and does NOT enforce `step`
 *    rounding on `input` / `change` events.
 *  - Safari is somewhere in between, and on locales with `,` as decimal
 *    separator may surface a comma in `value`.
 *
 * This helper normalises whatever string the browser hands us into a real
 * number and applies the same `min` / `max` / `step` constraints the
 * `<input>` element advertises, so downstream code sees identical values
 * regardless of browser.
 *
 * Returns `null` when the input cannot be parsed (e.g. empty string, "abc")
 * so callers can decide whether to fall back to a default.
 */
export function coerceNumber(
  raw: unknown,
  opts: { min?: number; max?: number; step?: number } = {},
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  // Replace decimal comma with dot before parsing — covers Firefox / Safari
  // on `de`, `fr`, `pt`, etc., where the user may type "1,5".
  const str = String(raw).replace(",", ".").trim();
  const n = Number(str);
  if (!Number.isFinite(n)) return null;
  let v = n;
  if (typeof opts.min === "number" && v < opts.min) v = opts.min;
  if (typeof opts.max === "number" && v > opts.max) v = opts.max;
  if (typeof opts.step === "number" && opts.step > 0) {
    const base = typeof opts.min === "number" ? opts.min : 0;
    v = base + Math.round((v - base) / opts.step) * opts.step;
    // Guard against FP drift from the round above ("0.30000000000000004").
    const decimals = (String(opts.step).split(".")[1] ?? "").length;
    if (decimals > 0) v = Number(v.toFixed(decimals));
  }
  return v;
}

export function handleError(e) {
  console.log("====e", e);
  if (e & e.response?.errors && e.response?.errors[0] && e.response?.errors[0].message) {
    message.error(e.response?.errors[0].message);
  } else {
    message.error(typeof e == "string" ? e : "Error!");
  }
}
