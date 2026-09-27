/**
 * Editor schema and HTML helpers for `RichTextEditor.vue`.
 *
 * The editor replaced a vendored TinyMCE 5, so the text it opens was mostly
 * written by TinyMCE (foyer description, e-mail signature) or seeded by hand.
 * Three things keep that text intact:
 *
 *  - `prepareHtml` rewrites markup the schema reads differently (colour on a
 *    `<b>`, `<font>`, underline as a styled span) into the form it understands;
 *  - the extensions below keep what TinyMCE's toolbar could produce (alignment,
 *    indent, colours, fonts, image size and float, tables);
 *  - `findLostMarkup` names whatever would still be dropped, so the editor can
 *    warn before the first keystroke instead of losing it silently.
 */
import { Extension, type CommandProps, type Extensions } from "@tiptap/vue-3";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";

export const INDENT_STEP_PX = 40;
export const INDENT_MAX_PX = 400;

const INDENT_TYPES = ["paragraph", "heading"];
const CELL_STYLE = "border: 1px solid #bfbfbf; padding: 4px 8px; vertical-align: top";

declare module "@tiptap/vue-3" {
  interface Commands<ReturnType> {
    indent: {
      /** Indent the selected paragraphs/headings by one step. */
      indent: () => ReturnType;
      /** Remove one indent step from the selected paragraphs/headings. */
      outdent: () => ReturnType;
    };
  }
}

/** Block indent stored the way TinyMCE wrote it: `padding-left: 40px`. */
export const Indent = Extension.create({
  name: "indent",

  addGlobalAttributes() {
    return [
      {
        types: INDENT_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              const raw = element.style.paddingLeft || element.style.marginLeft;
              const px = raw.endsWith("px") ? Math.round(parseFloat(raw)) : 0;
              return px > 0 ? Math.min(px, INDENT_MAX_PX) : 0;
            },
            renderHTML: (attributes) =>
              attributes.indent ? { style: `padding-left: ${attributes.indent}px` } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    const shift =
      (delta: number) =>
      () =>
      ({ tr, state, dispatch }: CommandProps) => {
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!INDENT_TYPES.includes(node.type.name)) return;
          const current = Number(node.attrs.indent) || 0;
          const next = Math.max(0, Math.min(INDENT_MAX_PX, current + delta));
          if (next === current) return;
          changed = true;
          if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
        });
        return changed;
      };
    return { indent: shift(INDENT_STEP_PX), outdent: shift(-INDENT_STEP_PX) };
  },
});

/** Inline image that keeps the size and float TinyMCE's image dialog set. */
const StyledImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: (element) => element.getAttribute("style"),
        renderHTML: (attributes) => (attributes.style ? { style: attributes.style } : {}),
      },
    };
  },
});

export function createExtensions(): Extensions {
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    }),
    StyledImage.configure({ inline: true, allowBase64: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TextStyleKit,
    // The look travels with the text: the foyer and e-mail clients have no table styles.
    TableKit.configure({
      table: { resizable: false, HTMLAttributes: { style: "border-collapse: collapse" } },
      tableCell: { HTMLAttributes: { style: CELL_STYLE } },
      tableHeader: { HTMLAttributes: { style: `${CELL_STYLE}; font-weight: 600` } },
    }),
    Indent,
  ];
}

const STYLED_INLINE_TAGS = "b, strong, i, em, u, s, strike, del";
const FONT_SIZE_BY_LEGACY_VALUE: Record<string, string> = {
  "1": "8pt",
  "2": "10pt",
  "3": "12pt",
  "4": "14pt",
  "5": "18pt",
  "6": "24pt",
  "7": "36pt",
};

function wrapChildrenInSpan(element: Element, style: string) {
  const doc = element.ownerDocument;
  const span = doc.createElement("span");
  span.setAttribute("style", style);
  while (element.firstChild) span.appendChild(element.firstChild);
  element.appendChild(span);
}

function renameElement(element: Element, tag: string): Element {
  const replacement = element.ownerDocument.createElement(tag);
  while (element.firstChild) replacement.appendChild(element.firstChild);
  element.replaceWith(replacement);
  return replacement;
}

/**
 * Rewrite markup the schema would read differently into what it understands.
 * Text and structure are untouched; only the carrier of a style changes.
 */
export function prepareHtml(html: string): string {
  if (!html || !html.includes("<")) return html ?? "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;

  // <font color face size> → <span style>
  body.querySelectorAll("font").forEach((font) => {
    const styles: string[] = [];
    const color = font.getAttribute("color");
    const face = font.getAttribute("face");
    const size = FONT_SIZE_BY_LEGACY_VALUE[font.getAttribute("size") ?? ""];
    if (color) styles.push(`color: ${color}`);
    if (face) styles.push(`font-family: ${face}`);
    if (size) styles.push(`font-size: ${size}`);
    const own = font.getAttribute("style");
    if (own) styles.push(own);
    const span = renameElement(font, "span");
    if (styles.length) span.setAttribute("style", styles.join("; "));
  });

  // <b style="color: …">text</b> → <b><span style="color: …">text</span></b>
  body.querySelectorAll(STYLED_INLINE_TAGS).forEach((element) => {
    const style = element.getAttribute("style");
    if (!style?.trim()) return;
    element.removeAttribute("style");
    wrapChildrenInSpan(element, style);
  });

  // <span style="text-decoration: underline"> → <u>, line-through → <s>
  body.querySelectorAll<HTMLElement>("span[style]").forEach((span) => {
    const decoration = `${span.style.textDecoration} ${span.style.textDecorationLine}`;
    const underline = decoration.includes("underline");
    const strike = decoration.includes("line-through");
    if (!underline && !strike) return;
    span.style.removeProperty("text-decoration");
    span.style.removeProperty("text-decoration-line");
    let inner: Element = span;
    if (underline) {
      const u = doc.createElement("u");
      while (inner.firstChild) u.appendChild(inner.firstChild);
      inner.appendChild(u);
      inner = u;
    }
    if (strike) {
      const s = doc.createElement("s");
      while (inner.firstChild) s.appendChild(inner.firstChild);
      inner.appendChild(s);
    }
    if (!span.getAttribute("style")?.trim()) {
      span.replaceWith(...Array.from(span.childNodes));
    }
  });

  return body.innerHTML;
}

/** Tags that are the same thing under another name, or pure wrappers. */
const TAG_EQUIVALENT: Record<string, string> = {
  b: "strong",
  i: "em",
  strike: "s",
  del: "s",
  font: "span",
};
/** Structure the editor adds or drops without changing what is shown. */
const IGNORED_TAGS = new Set(["span", "div", "p", "br", "tbody", "thead", "colgroup", "col"]);
const IGNORED_ATTRIBUTES = new Set([
  "style",
  "colspan",
  "rowspan",
  "rel",
  "target",
  "class",
  "data-mce-style",
  "data-mce-href",
  "data-mce-src",
  "data-mce-selected",
]);
/** Styles that say what the default already is, or that the editor re-adds itself. */
const IGNORED_STYLES = new Set(["min-width"]);

function styleNames(element: Element): string[] {
  const declared = (element as HTMLElement).style;
  const names: string[] = [];
  for (let i = 0; i < declared.length; i += 1) {
    const name = declared.item(i);
    // text-decoration arrives as <u>/<s>, so it is counted through the tag.
    if (name.startsWith("text-decoration")) continue;
    if (!IGNORED_STYLES.has(name)) names.push(name);
  }
  return names;
}

function markupInventory(html: string): Set<string> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const found = new Set<string>();
  // Text parked in a comment is invisible on the page but still somebody's draft.
  const comments = doc.createNodeIterator(doc.body, NodeFilter.SHOW_COMMENT);
  if (comments.nextNode()) found.add("<!-- comment -->");
  doc.body.querySelectorAll("*").forEach((element) => {
    const raw = element.tagName.toLowerCase();
    const tag = TAG_EQUIVALENT[raw] ?? raw;
    if (!IGNORED_TAGS.has(tag)) found.add(`<${tag}>`);
    for (const attribute of Array.from(element.attributes)) {
      if (!IGNORED_ATTRIBUTES.has(attribute.name)) found.add(`${attribute.name}="…"`);
    }
    for (const name of styleNames(element)) {
      // Indent is kept, but always written as padding-left.
      found.add(name === "margin-left" ? "padding-left" : name);
    }
  });
  return found;
}

function visibleText(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, "");
}

/**
 * What would be lost if `original` were saved as `roundTripped` (the editor's
 * own output for it): tags, attributes and style properties that no longer
 * appear anywhere, plus `text` when the wording itself differs.
 */
export function findLostMarkup(original: string, roundTripped: string): string[] {
  if (!original?.trim()) return [];
  const before = markupInventory(prepareHtml(original));
  const after = markupInventory(roundTripped);
  const lost = [...before].filter((item) => !after.has(item)).sort();
  if (visibleText(original) !== visibleText(roundTripped)) lost.unshift("text");
  return lost;
}

export const FONT_FAMILIES: Array<{ label: string; value: string }> = [
  { label: "Arial", value: "arial, helvetica, sans-serif" },
  { label: "Courier New", value: "'courier new', courier, monospace" },
  { label: "Georgia", value: "georgia, palatino, serif" },
  { label: "Helvetica", value: "helvetica, arial, sans-serif" },
  { label: "Tahoma", value: "tahoma, arial, helvetica, sans-serif" },
  { label: "Times New Roman", value: "'times new roman', times, serif" },
  { label: "Trebuchet MS", value: "'trebuchet ms', geneva, sans-serif" },
  { label: "Verdana", value: "verdana, geneva, sans-serif" },
];

export const FONT_SIZES = ["8pt", "10pt", "12pt", "14pt", "18pt", "24pt", "36pt"];
