// @vitest-environment jsdom
import { Editor } from "@tiptap/vue-3";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import RichTextEditor from "./RichTextEditor.vue";
import { createExtensions, findLostMarkup, prepareHtml } from "./richText";

/** What the editor would store for `html` once somebody edits it. */
const roundTrip = (html: string) => {
  const editor = new Editor({ extensions: createExtensions(), content: prepareHtml(html) });
  const output = editor.getHTML();
  editor.destroy();
  return output;
};

/** The text as stored on dev on 2026-09-28, written with TinyMCE. */
const FOYER_DESCRIPTION = `<h3 style="text-align: center;"><em>online venue for live performance and remote collaboration</em></h3>
<h1 style="text-align: center;"><em>development server</em></h1>
<p>&nbsp;</p>`;

/** The seeded e-mail signature, including its stray closing tag. */
const EMAIL_SIGNATURE = `
                Thank you,
                <br>
                <b style="color: #007011">The UpStage Team!</b>
                </p>`;

describe("stored text survives the editor", () => {
  it("keeps the foyer description as TinyMCE wrote it", () => {
    expect(roundTrip(FOYER_DESCRIPTION)).toBe(
      '<h3 style="text-align: center;"><em>online venue for live performance and remote collaboration</em></h3>' +
        '<h1 style="text-align: center;"><em>development server</em></h1>' +
        "<p>&nbsp;</p>",
    );
    expect(findLostMarkup(FOYER_DESCRIPTION, roundTrip(FOYER_DESCRIPTION))).toEqual([]);
  });

  it("keeps the colour of the e-mail signature", () => {
    const output = roundTrip(EMAIL_SIGNATURE);
    expect(output).toContain("Thank you,");
    expect(output).toMatch(
      /<span style="color: (#007011|rgb\(0, 112, 17\));?"><strong>The UpStage Team!<\/strong><\/span>/,
    );
    expect(findLostMarkup(EMAIL_SIGNATURE, output)).toEqual([]);
  });

  it.each([
    ["underline span", '<p><span style="text-decoration: underline;">u</span></p>', "<u>u</u>"],
    ["strike span", '<p><span style="text-decoration: line-through;">s</span></p>', "<s>s</s>"],
    ["indent", '<p style="padding-left: 80px;">in</p>', "padding-left: 80px"],
    ["alignment", '<p style="text-align: right;">r</p>', "text-align: right"],
    ["text colour", '<p><span style="color: #e03e2d;">c</span></p>', "color:"],
    ["background", '<p><span style="background-color: #f1c40f;">b</span></p>', "background-color:"],
    ["font size", '<p><span style="font-size: 18pt;">f</span></p>', "font-size: 18pt"],
    ["font family", "<p><span style=\"font-family: 'courier new';\">f</span></p>", "font-family:"],
    ["legacy font tag", '<p><font color="#ff0000" size="5">f</font></p>', "font-size: 18pt"],
    [
      "image size",
      '<p><img src="https://x/y.png" alt="a" width="100" height="50"></p>',
      'width="100"',
    ],
    ["image float", '<p><img style="float: right;" src="https://x/y.png"></p>', "float: right"],
    [
      "link",
      '<p><a href="https://upstage.live" title="t">l</a></p>',
      'href="https://upstage.live"',
    ],
    ["rule", "<p>a</p><hr><p>b</p>", "<hr>"],
    ["nested list", "<ul><li>one<ul><li>two</li></ul></li></ul>", "<ul><li><p>two</p></li></ul>"],
    ["table", "<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>", "<td"],
  ])("keeps %s", (_name, html, expected) => {
    const output = roundTrip(html);
    expect(output).toContain(expected);
    expect(findLostMarkup(html, output)).toEqual([]);
  });

  it("names what it cannot keep", () => {
    const html =
      '<p>H<sub>2</sub>O</p><table style="width: 50%;" border="1"><tbody><tr><td>a</td></tr></tbody></table>';
    expect(findLostMarkup(html, roundTrip(html))).toEqual(["<sub>", 'border="…"', "width"]);
  });

  it("names a comment holding parked text", () => {
    const html = "<p>shown</p><!-- <p>parked for the next event</p> -->";
    const output = roundTrip(html);
    expect(output).toBe("<p>shown</p>");
    expect(findLostMarkup(html, output)).toEqual(["<!-- comment -->"]);
  });

  it("reports changed wording", () => {
    expect(findLostMarkup("<p>one two</p>", "<p>one</p>")).toContain("text");
  });

  it("does not execute or keep script", () => {
    const output = roundTrip('<p onclick="alert(1)">a</p><script>alert(1)</script>');
    expect(output).not.toContain("script");
    expect(output).not.toContain("onclick");
  });
});

describe("RichTextEditor", () => {
  // jsdom has no layout; ProseMirror asks for rectangles when it scrolls to the caret.
  beforeAll(() => {
    const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };
    const noRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
    const zeroRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
    Range.prototype.getClientRects = noRects;
    Range.prototype.getBoundingClientRect = zeroRect;
    Element.prototype.getClientRects = noRects;
  });

  const wrappers: Array<ReturnType<typeof mount>> = [];
  const mountEditor = async (props: Record<string, unknown>) => {
    const wrapper = mount(RichTextEditor, { props, attachTo: document.body });
    wrappers.push(wrapper);
    await flushPromises();
    return wrapper;
  };

  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    vi.restoreAllMocks();
  });

  it("shows the stored text without emitting a change", async () => {
    const wrapper = await mountEditor({ modelValue: EMAIL_SIGNATURE });
    expect(wrapper.find(".rich-text-content").text()).toContain("The UpStage Team!");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("does not emit when the parent replaces the text", async () => {
    const wrapper = await mountEditor({ modelValue: "<p>one</p>" });
    await wrapper.setProps({ modelValue: FOYER_DESCRIPTION });
    expect(wrapper.find(".rich-text-content").text()).toContain("development server");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("emits HTML on a toolbar edit and an empty string for an empty document", async () => {
    const wrapper = await mountEditor({ modelValue: "<p>one</p>" });
    await wrapper.find('button[title="Horizontal line"]').trigger("click");
    const emitted = wrapper.emitted("update:modelValue") as string[][];
    expect(emitted.at(-1)?.[0]).toContain("<hr>");

    const empty = await mountEditor({ modelValue: "" });
    await empty.find('button[title="Bold"]').trigger("click");
    const values = (empty.emitted("update:modelValue") ?? []) as string[][];
    values.forEach(([value]) => expect(value).toBe(""));
  });

  it("disables the toolbar and the text while read-only", async () => {
    const wrapper = await mountEditor({ modelValue: "<p>one</p>", readonly: true });
    expect(wrapper.find(".rich-text-content").attributes("contenteditable")).toBe("false");
    expect(wrapper.find('button[title="Bold"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('button[title="Edit as HTML"]').attributes("disabled")).toBeDefined();

    await wrapper.setProps({ readonly: false });
    expect(wrapper.find(".rich-text-content").attributes("contenteditable")).toBe("true");
    expect(wrapper.find('button[title="Bold"]').attributes("disabled")).toBeUndefined();
  });

  it("warns about formatting it cannot keep, and only while editing", async () => {
    const html = "<p>H<sub>2</sub>O</p>";
    const wrapper = await mountEditor({ modelValue: html, readonly: true });
    expect(wrapper.find(".rich-text-warning").exists()).toBe(false);
    await wrapper.setProps({ readonly: false });
    expect(wrapper.find(".rich-text-warning").text()).toContain("<sub>");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("edits the stored HTML itself in HTML mode", async () => {
    const html = "<p>H<sub>2</sub>O</p>";
    const wrapper = await mountEditor({ modelValue: html });
    await wrapper.find('button[title="Edit as HTML"]').trigger("click");
    const textarea = wrapper.find("textarea.rich-text-source");
    expect((textarea.element as HTMLTextAreaElement).value).toBe(html);

    await textarea.setValue("<p>CO<sub>2</sub></p>");
    const emitted = wrapper.emitted("update:modelValue") as string[][];
    expect(emitted.at(-1)?.[0]).toBe("<p>CO<sub>2</sub></p>");

    // Back to the visual editor: shown, but still not rewritten.
    await wrapper.setProps({ modelValue: "<p>CO<sub>2</sub></p>" });
    await wrapper.find('button[title="Edit as HTML"]').trigger("click");
    expect(wrapper.find(".rich-text-content").text()).toContain("CO2");
    expect(emitted).toHaveLength(1);
  });

  it("sets and removes a link", async () => {
    const wrapper = await mountEditor({ modelValue: "<p>upstage</p>" });
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("https://upstage.live");
    // Select the whole paragraph the way Ctrl+A would.
    const content = wrapper.find(".rich-text-content").element as HTMLElement & {
      editor?: Editor;
    };
    content.editor?.commands.selectAll();
    await wrapper.find('button[title="Link"]').trigger("click");
    let emitted = wrapper.emitted("update:modelValue") as string[][];
    expect(emitted.at(-1)?.[0]).toContain('href="https://upstage.live"');

    prompt.mockReturnValue("");
    content.editor?.commands.selectAll();
    await wrapper.find('button[title="Link"]').trigger("click");
    emitted = wrapper.emitted("update:modelValue") as string[][];
    expect(emitted.at(-1)?.[0]).toBe("<p>upstage</p>");
  });
});
