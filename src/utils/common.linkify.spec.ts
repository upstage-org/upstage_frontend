import { describe, expect, it } from "vitest";
import { linkify } from "./common";
import { escapeHtml, safeLinkUrl, sanitizeRichText } from "./sanitizeHtml";

describe("linkify", () => {
  it("escapes HTML so chat text can never inject markup", () => {
    const html = linkify('<img src=x onerror="alert(1)"> hi');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; hi");
  });

  it("still turns URLs into anchors with safe attributes", () => {
    const html = linkify("see https://upstage.live/docs now");
    expect(html).toBe(
      'see <a href="https://upstage.live/docs" target="_blank" rel="noopener noreferrer">https://upstage.live/docs</a> now',
    );
  });

  it("links www. and e-mail addresses", () => {
    expect(linkify("go www.example.org")).toContain('href="http://www.example.org"');
    expect(linkify("mail me@example.org")).toContain('href="mailto:me@example.org"');
  });

  it("does not let an escaped quote break out of the href", () => {
    const html = linkify('https://a.b/"onmouseover="x');
    expect(html).not.toMatch(/onmouseover=[^&]/);
  });
});

describe("escapeHtml", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
  });
});

describe("sanitizeRichText", () => {
  it("strips scripts and event handlers but keeps formatting", () => {
    const out = sanitizeRichText('<b>bold</b><script>alert(1)</script><img src=x onerror="x">');
    expect(out).toContain("<b>bold</b>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onerror");
  });

  it("forces rel=noopener on links and drops javascript: hrefs", () => {
    expect(sanitizeRichText('<a href="https://x.y" target="_blank">l</a>')).toContain(
      'rel="noopener noreferrer"',
    );
    expect(sanitizeRichText('<a href="javascript:alert(1)">l</a>')).not.toContain("javascript:");
  });

  it("returns an empty string for null/undefined", () => {
    expect(sanitizeRichText(null)).toBe("");
    expect(sanitizeRichText(undefined)).toBe("");
  });
});

describe("safeLinkUrl", () => {
  it("accepts http(s) and mailto only", () => {
    expect(safeLinkUrl("https://upstage.live")).toBe("https://upstage.live/");
    expect(safeLinkUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(safeLinkUrl("data:text/html,hi")).toBeNull();
    expect(safeLinkUrl("")).toBeNull();
    expect(safeLinkUrl(undefined)).toBeNull();
  });
});
