// @vitest-environment jsdom
import { Editor } from "@tiptap/vue-3";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import RichTextEditor from "./RichTextEditor.vue";
import {
  createExtensions,
  findLostMarkup,
  prepareHtml,
  sizeFromStyle,
  withoutSize,
} from "./richText";

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

  it("reads and strips a size kept in style", () => {
    expect(sizeFromStyle("float: right; width: 120px; height: 60.4px")).toEqual({
      width: 120,
      height: 60,
    });
    expect(sizeFromStyle("float: right")).toEqual({ width: 0, height: 0 });
    expect(withoutSize("float: right; width: 120px; height: 60px")).toBe("float: right");
    expect(withoutSize("width: 120px")).toBeNull();
    expect(withoutSize(null)).toBeNull();
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

  /** Issue #1575: the image dialog, handles and preview TinyMCE had. */
  describe("images", () => {
    const IMAGE = '<p><img src="https://x/logo.png" alt="Logo" width="200" height="100"></p>';
    const editorOf = (wrapper: ReturnType<typeof mount>) =>
      (wrapper.find(".rich-text-content").element as HTMLElement & { editor?: Editor }).editor!;
    const selectImage = async (wrapper: ReturnType<typeof mount>) => {
      // The image is the first inline node of the first paragraph: position 1.
      editorOf(wrapper).commands.setNodeSelection(1);
      await flushPromises();
    };
    const lastEmitted = (wrapper: ReturnType<typeof mount>) =>
      (wrapper.emitted("update:modelValue") as string[][]).at(-1)?.[0] ?? "";

    it("inserts an image with address, alternative text and size from the dialog", async () => {
      const wrapper = await mountEditor({ modelValue: "<p>sig</p>" });
      expect(wrapper.find('button[title="Insert image from address"]').exists()).toBe(false);
      await wrapper.find('button[title="Image"]').trigger("click");
      const dialog = wrapper.find('[role="dialog"]');
      expect(dialog.text()).toContain("Insert image");
      await dialog.find('input[name="src"]').setValue("https://x/logo.png");
      await dialog.find('input[name="alt"]').setValue("Our logo");
      await dialog.find('input[name="width"]').setValue("120");
      await dialog.find('input[name="height"]').setValue("60");
      await dialog.trigger("submit");
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      const html = lastEmitted(wrapper);
      expect(html).toContain('src="https://x/logo.png"');
      expect(html).toContain('alt="Our logo"');
      expect(html).toContain('width="120"');
      expect(html).toContain('height="60"');
    });

    it("keeps proportions while a size is typed", async () => {
      const wrapper = await mountEditor({ modelValue: IMAGE });
      await selectImage(wrapper);
      await wrapper.find('button[title="Image"]').trigger("click");
      const dialog = wrapper.find('[role="dialog"]');
      expect(dialog.text()).toContain("Image properties");
      const width = dialog.find('input[name="width"]');
      const height = dialog.find('input[name="height"]');
      expect((width.element as HTMLInputElement).value).toBe("200");
      await width.setValue("100");
      expect((height.element as HTMLInputElement).value).toBe("50");
      await dialog.find('input[name="constrain"]').setValue(false);
      await width.setValue("300");
      expect((height.element as HTMLInputElement).value).toBe("50");
    });

    it("edits the selected image's properties and drops the size kept in style", async () => {
      const wrapper = await mountEditor({
        modelValue: '<p><img src="https://x/a.png" style="float: right; width: 80px"></p>',
      });
      await selectImage(wrapper);
      await wrapper.find('button[title="Image"]').trigger("click");
      const dialog = wrapper.find('[role="dialog"]');
      expect((dialog.find('input[name="src"]').element as HTMLInputElement).value).toBe(
        "https://x/a.png",
      );
      expect((dialog.find('input[name="width"]').element as HTMLInputElement).value).toBe("80");
      await dialog.find('input[name="alt"]').setValue("Portrait");
      await dialog.find('input[name="width"]').setValue("160");
      await dialog.trigger("submit");
      const html = lastEmitted(wrapper);
      expect(html).toContain('alt="Portrait"');
      expect(html).toContain('width="160"');
      expect(html).toMatch(/style="float: right;?"/);
      expect(html).not.toContain("width: 80px");
      expect(html.match(/<img/g)).toHaveLength(1);
    });

    it("cancels without changing anything", async () => {
      const wrapper = await mountEditor({ modelValue: IMAGE });
      await selectImage(wrapper);
      await wrapper.find('button[title="Image"]').trigger("click");
      await wrapper.find('[role="dialog"] input[name="alt"]').setValue("changed");
      await wrapper.find('[role="dialog"]').trigger("keydown", { key: "Escape" });
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    });

    it("opens the properties on double-click and right-click", async () => {
      const wrapper = await mountEditor({ modelValue: IMAGE });
      await wrapper.find(".rich-text-image img").trigger("dblclick");
      expect(wrapper.find('[role="dialog"]').text()).toContain("Image properties");
      await wrapper.find('[role="dialog"] button.cancel').trigger("click");
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);

      const contextmenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      wrapper.find(".rich-text-image img").element.dispatchEvent(contextmenu);
      await flushPromises();
      expect(contextmenu.defaultPrevented).toBe(true);
      expect(wrapper.find('[role="dialog"]').text()).toContain("Image properties");
    });

    it("shows handles on the selected image and resizes it by dragging one", async () => {
      const wrapper = await mountEditor({ modelValue: IMAGE });
      expect(wrapper.findAll(".rich-text-image-handle")).toHaveLength(0);
      await selectImage(wrapper);
      const handles = wrapper.findAll(".rich-text-image-handle");
      expect(handles).toHaveLength(4);

      const handle = wrapper.find('.rich-text-image-handle[data-corner="se"]');
      await handle.trigger("mousedown", { clientX: 200, clientY: 100 });
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 100 }));
      await flushPromises();
      expect(wrapper.find(".rich-text-image-size").text()).toBe("300 × 150");
      // Nothing is stored while the mouse is down.
      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 300, clientY: 100 }));
      await flushPromises();
      const html = lastEmitted(wrapper);
      expect(html).toContain('width="300"');
      expect(html).toContain('height="150"');
      expect(wrapper.find(".rich-text-image-size").exists()).toBe(false);
    });

    it("shrinks from a left handle and never below the minimum size", async () => {
      const wrapper = await mountEditor({ modelValue: IMAGE });
      await selectImage(wrapper);
      await wrapper
        .find('.rich-text-image-handle[data-corner="nw"]')
        .trigger("mousedown", { clientX: 0, clientY: 0 });
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 1000, clientY: 0 }));
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 1000, clientY: 0 }));
      await flushPromises();
      expect(lastEmitted(wrapper)).toContain('width="16"');
    });

    it("has no handles and no dialog while read-only", async () => {
      const wrapper = await mountEditor({ modelValue: IMAGE, readonly: true });
      editorOf(wrapper).commands.setNodeSelection(1);
      await flushPromises();
      expect(wrapper.findAll(".rich-text-image-handle")).toHaveLength(0);
      await wrapper.find(".rich-text-image img").trigger("dblclick");
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    });
  });

  it("stores Unicode text as the characters themselves", async () => {
    const text = "Kia ora — café 日本語 😀 עברית ‘quoted’ €";
    expect(roundTrip(`<p>${text}</p>`)).toBe(`<p>${text}</p>`);
    const wrapper = await mountEditor({ modelValue: "<p></p>" });
    const content = wrapper.find(".rich-text-content").element as HTMLElement & {
      editor?: Editor;
    };
    content.editor?.chain().focus().insertContent(text).run();
    await flushPromises();
    const html = (wrapper.emitted("update:modelValue") as string[][]).at(-1)?.[0] ?? "";
    expect(html).toContain(text);
    expect(html).not.toMatch(/&(?!nbsp;|amp;|lt;|gt;)[a-z]+;/);
  });

  describe("special characters", () => {
    it("offers TinyMCE's groups and inserts the chosen character", async () => {
      const wrapper = await mountEditor({ modelValue: "<p>Price: </p>" });
      await wrapper.find('button[title="Special character"]').trigger("click");
      const dialog = wrapper.find('[role="dialog"]');
      expect(dialog.text()).toContain("Special character");
      const groups = dialog.findAll('[role="tab"]').map((tab) => tab.text());
      expect(groups).toEqual([
        "Currency",
        "Text",
        "Quotations",
        "Mathematical",
        "Extended Latin",
        "Symbols",
        "Arrows",
      ]);
      await dialog.find('[data-character="€"]').trigger("click");
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      const html = (wrapper.emitted("update:modelValue") as string[][]).at(-1)?.[0] ?? "";
      expect(html).toContain("€");
      expect(html).not.toContain("&euro;");
    });

    it("searches by name and shows every group's characters", async () => {
      const wrapper = await mountEditor({ modelValue: "<p>x</p>" });
      await wrapper.find('button[title="Special character"]').trigger("click");
      const dialog = wrapper.find('[role="dialog"]');
      await dialog.find('input[name="search"]').setValue("dash");
      const found = dialog.findAll('[role="option"]').map((o) => o.attributes("data-character"));
      expect(found).toContain("—");
      expect(found).toContain("–");
      expect(dialog.find('[role="tab"]').exists()).toBe(false);

      await dialog.find('input[name="search"]').setValue("");
      await dialog
        .findAll('[role="tab"]')
        .find((t) => t.text() === "Arrows")!
        .trigger("click");
      expect(
        dialog.findAll('[role="option"]').map((o) => o.attributes("data-character")),
      ).toContain("→");
    });
  });

  it("toggles fullscreen and leaves it with Esc", async () => {
    const wrapper = await mountEditor({ modelValue: "<p>one</p>" });
    expect(wrapper.classes()).not.toContain("is-fullscreen");
    await wrapper.find('button[title="Fullscreen"]').trigger("click");
    expect(wrapper.classes()).toContain("is-fullscreen");
    expect(document.body.classList.contains("rich-text-fullscreen-open")).toBe(true);
    expect(wrapper.find('button[title="Exit fullscreen"]').exists()).toBe(true);

    await wrapper.find(".rich-text-content").trigger("keydown", { key: "Escape" });
    expect(wrapper.classes()).not.toContain("is-fullscreen");
    expect(document.body.classList.contains("rich-text-fullscreen-open")).toBe(false);
  });

  it("shows the keyboard shortcuts help", async () => {
    const wrapper = await mountEditor({ modelValue: "<p>one</p>" });
    await wrapper.find('button[title="Help"]').trigger("click");
    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.text()).toContain("Editor help");
    expect(dialog.text()).toMatch(/Bold/);
    await dialog.find("button.cancel").trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it("previews the text in a sandboxed frame, including unsaved HTML-mode edits", async () => {
    const wrapper = await mountEditor({ modelValue: "<p>one</p>" });
    await wrapper.find('button[title="Preview"]').trigger("click");
    let frame = wrapper.find("iframe.rich-text-preview-frame");
    expect(frame.attributes("sandbox")).toBe("");
    expect(frame.attributes("srcdoc")).toContain("<p>one</p>");
    await wrapper.find('button[title="Close preview"]').trigger("click");
    expect(wrapper.find("iframe.rich-text-preview-frame").exists()).toBe(false);

    await wrapper.find('button[title="Edit as HTML"]').trigger("click");
    await wrapper.find("textarea.rich-text-source").setValue("<p>H<sub>2</sub>O</p>");
    await wrapper.find('button[title="Preview"]').trigger("click");
    frame = wrapper.find("iframe.rich-text-preview-frame");
    expect(frame.attributes("srcdoc")).toContain("<p>H<sub>2</sub>O</p>");
  });
});
