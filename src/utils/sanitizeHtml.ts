/**
 * HTML sanitising for the few places the studio renders markup it did not
 * author itself: rich-text stage objects (contenteditable output that is
 * broadcast over MQTT to every viewer), the foyer title/description from
 * site config, and the linkified chat lines.
 *
 * Everything goes through DOMPurify with the default HTML profile, which
 * strips scripts, event handlers, `javascript:` URLs and the like while
 * keeping the formatting tags the text tool produces (`<b>`, `<i>`, `<u>`,
 * `<div>`, `<br>`, `<font>`, `<span style>`).
 */
import DOMPurify from "dompurify";

const RICH_TEXT_OPTIONS: DOMPurify.Config = {
  USE_PROFILES: { html: true },
  // Links must never re-target the opener or run script.
  ADD_ATTR: ["target"],
  FORBID_TAGS: ["style", "form", "input", "textarea", "button", "iframe", "object", "embed"],
};

if (typeof window !== "undefined") {
  // Force safe link attributes on every anchor that survives sanitising.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("rel", "noopener noreferrer");
      if (node.getAttribute("target") && node.getAttribute("target") !== "_blank") {
        node.removeAttribute("target");
      }
    }
  });
}

/** Sanitise rich text (contenteditable HTML, foyer config) for `innerHTML` / `v-html`. */
export function sanitizeRichText(html: unknown): string {
  if (html == null) return "";
  return DOMPurify.sanitize(String(html), RICH_TEXT_OPTIONS);
}

/** Escape a plain string so it can be interpolated into HTML as text. */
export function escapeHtml(text: unknown): string {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Return `url` if it is an http(s)/mailto link, else `null`. Used before
 * `window.open` on player-authored prop links so a `javascript:` URL can
 * never run in the audience's page.
 */
export function safeLinkUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim(), window.location.href);
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Open a player-authored link safely (validated scheme, no opener access). */
export function openSafeLink(url: unknown, blank: boolean): void {
  const target = safeLinkUrl(url);
  if (!target) return;
  if (blank) {
    window.open(target, "_blank", "noopener,noreferrer");
  } else {
    window.location.assign(target);
  }
}
