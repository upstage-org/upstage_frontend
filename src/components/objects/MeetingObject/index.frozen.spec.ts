// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * FROZEN behaviour of the embedded meeting (MeetingObject/index.vue).
 *
 * Written on 2026-11-28, BEFORE the audience-tools work for #1580, against
 * the code as it then stood, and required to keep passing unchanged after
 * it. It pins, character for character, everything a meeting sends to the
 * Jitsi server and everything the tile looks like:
 *
 *   - the iframe address (room + every `config.*` / `interfaceConfig.*` /
 *     `userInfo.*` setting, in order) for a performer and for the audience;
 *   - the browser permissions handed to the iframe (`allow`), fullscreen,
 *     referrer policy;
 *   - the rendered markup of the tile in each state;
 *   - the component's template and stylesheet source.
 *
 * Meetings are production-critical for live performances. If one of these
 * assertions fails, a change has altered how existing meetings behave or
 * look. Do not update the expected values to make it pass unless that
 * alteration is exactly what was asked for.
 *
 * The new, optional audience-tools setting is covered in
 * `index.audienceTools.spec.ts`; here it only appears to prove that leaving
 * it off — or setting it on a performer's side — changes nothing at all.
 */

const state = vi.hoisted(() => ({
  chatname: "Tester" as string,
  user: null as { email?: string } | null,
}));

vi.mock("ant-design-vue", () => ({ Modal: { confirm: vi.fn() } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("./composable", () => ({
  useJitsiEndpoint: () => ({ host: "meet.test", httpScheme: "https" }),
}));
vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({
    canPlay: true,
    meetingRefreshKey: 0,
    activeMovable: false,
    startAttachingProp: vi.fn(),
    shapeObject: vi.fn(),
  });
  return { useStageStore: () => store };
});
vi.mock("@stores/pinia/user", () => ({
  useUserStore: () => ({
    get chatname() {
      return state.chatname;
    },
    get user() {
      return state.user;
    },
  }),
}));

import { useStageStore } from "@stores/pinia/stage";
import MeetingObject from "./index.vue";

const store = () => useStageStore() as unknown as { canPlay: boolean };

// ---------------------------------------------------------------------------
// The exact addresses produced on 2026-11-28.
// ---------------------------------------------------------------------------
const COMMON =
  "config.prejoinPageEnabled=false" +
  "&config.prejoinConfig=%7B%22enabled%22%3Afalse%7D" +
  "&config.startVideoMuted=1" +
  "&config.startAudioMuted=1";

const PERFORMER_SETTINGS =
  COMMON +
  "&config.disableInitialGUM=false" +
  "&interfaceConfig.SHOW_CHROME_EXTENSION_BANNER=false";

const AUDIENCE_SETTINGS =
  COMMON +
  "&config.disableInitialGUM=true" +
  "&config.toolbarButtons=%5B%5D" +
  "&config.disableShortcuts=true" +
  "&config.readOnlyName=true" +
  "&config.disableDeepLinking=true" +
  "&config.disableInviteFunctions=true" +
  "&config.disableProfile=true" +
  "&config.disableReactions=true" +
  "&config.disableReactionsInChat=true" +
  "&config.disableModeratorIndicator=true" +
  "&config.disableRemoteMute=true" +
  "&config.disableSelfView=true" +
  "&config.disableSelfViewSettings=true" +
  "&config.disableLocalVideoFlip=true" +
  "&config.hiddenPremeetingButtons=%5B%22microphone%22%2C%22camera%22%2C%22select-background%22%2C%22invite%22%2C%22settings%22%5D" +
  "&config.filmstrip=%7B%22disableResizable%22%3Atrue%2C%22disableStageFilmstrip%22%3Atrue%7D" +
  "&config.remoteVideoMenu=%7B%22disabled%22%3Atrue%2C%22disableKick%22%3Atrue%2C%22disableGrantModerator%22%3Atrue%2C%22disablePrivateChat%22%3A%22all%22%2C%22disableDemote%22%3Atrue%7D" +
  "&config.participantsPane=%7B%22hideModeratorSettingsTab%22%3Atrue%2C%22hideMoreActionsButton%22%3Atrue%2C%22hideMuteAllButton%22%3Atrue%7D" +
  "&interfaceConfig.SHOW_CHROME_EXTENSION_BANNER=false" +
  "&interfaceConfig.TOOLBAR_BUTTONS=%5B%5D" +
  "&interfaceConfig.SETTINGS_SECTIONS=%5B%5D" +
  "&interfaceConfig.MOBILE_APP_PROMO=false" +
  "&interfaceConfig.SHARING_FEATURES=%5B%5D" +
  "&interfaceConfig.DISABLE_JOIN_LEAVE_NOTIFICATIONS=true";

const PERFORMER_SRC = `https://meet.test/room-1#${PERFORMER_SETTINGS}&userInfo.displayName=%22Tester%22`;
const AUDIENCE_SRC = `https://meet.test/room-1#${AUDIENCE_SETTINGS}&userInfo.displayName=%22Tester%22`;

const PERFORMER_ALLOW = "camera; microphone; display-capture; autoplay";
const AUDIENCE_ALLOW = "autoplay";

const mounted: Array<{ unmount: () => void }> = [];
function mountTile(object: Record<string, unknown> = {}, provide: Record<string, unknown> = {}) {
  const w = mount(MeetingObject, {
    props: { object: { id: "m1", type: "meeting", name: "room-1", w: 640, h: 360, ...object } },
    attachTo: document.body,
    global: {
      provide,
      mocks: { $t: (k: string) => k },
      stubs: { AppObject: { template: "<div><slot name='render' /></div>" } },
    },
  });
  mounted.push(w);
  return w;
}
const iframe = (w: ReturnType<typeof mountTile>) => w.find("iframe");

beforeEach(() => {
  vi.useFakeTimers();
  store().canPlay = true;
  state.chatname = "Tester";
  state.user = null;
});
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  vi.useRealTimers();
});

describe("frozen: what a PERFORMER's meeting sends to Jitsi", () => {
  it("address, character for character", () => {
    expect(iframe(mountTile()).attributes("src")).toBe(PERFORMER_SRC);
  });

  it("browser permissions, fullscreen, referrer policy, class", () => {
    const el = iframe(mountTile());
    expect(el.attributes("allow")).toBe(PERFORMER_ALLOW);
    expect(el.attributes("allowfullscreen")).toBe(""); // present
    expect(el.attributes("referrerpolicy")).toBe("no-referrer-when-downgrade");
    expect(el.classes()).toEqual(["room"]);
  });

  it("room names are URL-encoded; name and e-mail of a logged-in player are passed on", () => {
    state.chatname = "Helen V";
    state.user = { email: "helen@example.org" };
    expect(iframe(mountTile({ name: "Workshop Room/2 & more" })).attributes("src")).toBe(
      `https://meet.test/Workshop%20Room%2F2%20%26%20more#${PERFORMER_SETTINGS}` +
        "&userInfo.displayName=%22Helen%20V%22&userInfo.email=%22helen%40example.org%22",
    );
  });

  it.each([
    ["absent", {}],
    ["microphone", { audienceTools: "mic" }],
    ["microphone + camera", { audienceTools: "mic-camera" }],
    ["off", { audienceTools: "none" }],
    ["nonsense", { audienceTools: "everything" }],
    ["null", { audienceTools: null }],
  ])("is the same whatever the audience-tools setting is (%s)", (_name, extra) => {
    const el = iframe(mountTile(extra));
    expect(el.attributes("src")).toBe(PERFORMER_SRC);
    expect(el.attributes("allow")).toBe(PERFORMER_ALLOW);
    expect(el.attributes("allowfullscreen")).toBe(""); // present
  });
});

describe("frozen: what an AUDIENCE member's meeting sends to Jitsi (tools off)", () => {
  beforeEach(() => {
    store().canPlay = false;
  });

  it("address, character for character", () => {
    expect(iframe(mountTile()).attributes("src")).toBe(AUDIENCE_SRC);
  });

  it("browser permissions: playback only — no camera, no microphone, no fullscreen", () => {
    const el = iframe(mountTile());
    expect(el.attributes("allow")).toBe(AUDIENCE_ALLOW);
    expect(el.attributes("allowfullscreen")).toBeUndefined(); // absent
    expect(el.attributes("referrerpolicy")).toBe("no-referrer-when-downgrade");
    expect(el.classes()).toEqual(["room"]);
  });

  it("an unnamed visitor is called Guest", () => {
    state.chatname = "";
    expect(iframe(mountTile({ name: "Workshop Room/2 & more" })).attributes("src")).toBe(
      `https://meet.test/Workshop%20Room%2F2%20%26%20more#${AUDIENCE_SETTINGS}&userInfo.displayName=%22Guest%22`,
    );
  });

  it.each([
    ["absent", {}],
    ["undefined", { audienceTools: undefined }],
    ["null", { audienceTools: null }],
    ["off", { audienceTools: "none" }],
    ["empty", { audienceTools: "" }],
    ["nonsense word", { audienceTools: "everything" }],
    ["wrong case", { audienceTools: "MIC" }],
    ["a number", { audienceTools: 1 }],
    ["true", { audienceTools: true }],
    ["an object", { audienceTools: { mic: true } }],
    ["an array", { audienceTools: ["mic"] }],
  ])("stays exactly this with the setting %s", (_name, extra) => {
    const el = iframe(mountTile(extra));
    expect(el.attributes("src")).toBe(AUDIENCE_SRC);
    expect(el.attributes("allow")).toBe(AUDIENCE_ALLOW);
    expect(el.attributes("allowfullscreen")).toBeUndefined(); // absent
  });
});

describe("frozen: the tile's markup", () => {
  it("performer, loading", () => {
    expect(mountTile().html()).toMatchInlineSnapshot(`
      "<div data-v-93044b1c="">
        <div data-v-93044b1c="" object="[object Object]">
          <div data-v-93044b1c="" id="meeting-room" class="frame" style="width: 640px; height: 360px;">
            <!--
                  Use the same small spinner GIF as the individual-stream tile
                  (Yourself.vue / Jitsi.vue). The previous \`<Loading />\` here
                  rendered \`/img/loading.svg\` at \`height: 100%\`, which briefly
                  painted a giant orange/cream striped square over the whole
                  meeting before the iframe finished loading.
                --><img data-v-93044b1c="" class="overlay" src="/img/videoloading.gif">
            <!--v-if--><iframe data-v-93044b1c="" class="room" src="https://meet.test/room-1#config.prejoinPageEnabled=false&amp;config.prejoinConfig=%7B%22enabled%22%3Afalse%7D&amp;config.startVideoMuted=1&amp;config.startAudioMuted=1&amp;config.disableInitialGUM=false&amp;interfaceConfig.SHOW_CHROME_EXTENSION_BANNER=false&amp;userInfo.displayName=%22Tester%22" allow="camera; microphone; display-capture; autoplay" allowfullscreen="" referrerpolicy="no-referrer-when-downgrade"></iframe>
          </div>
        </div>
      </div>"
    `);
  });

  it("performer, loaded", async () => {
    const w = mountTile();
    await iframe(w).trigger("load");
    expect(w.html()).toMatchInlineSnapshot(`
      "<div data-v-93044b1c="">
        <div data-v-93044b1c="" object="[object Object]">
          <div data-v-93044b1c="" id="meeting-room" class="frame" style="width: 640px; height: 360px;">
            <!--
                  Use the same small spinner GIF as the individual-stream tile
                  (Yourself.vue / Jitsi.vue). The previous \`<Loading />\` here
                  rendered \`/img/loading.svg\` at \`height: 100%\`, which briefly
                  painted a giant orange/cream striped square over the whole
                  meeting before the iframe finished loading.
                -->
            <!--v-if-->
            <!--v-if--><iframe data-v-93044b1c="" class="room" src="https://meet.test/room-1#config.prejoinPageEnabled=false&amp;config.prejoinConfig=%7B%22enabled%22%3Afalse%7D&amp;config.startVideoMuted=1&amp;config.startAudioMuted=1&amp;config.disableInitialGUM=false&amp;interfaceConfig.SHOW_CHROME_EXTENSION_BANNER=false&amp;userInfo.displayName=%22Tester%22" allow="camera; microphone; display-capture; autoplay" allowfullscreen="" referrerpolicy="no-referrer-when-downgrade"></iframe>
          </div>
        </div>
      </div>"
    `);
  });

  it("audience, loaded", async () => {
    store().canPlay = false;
    const w = mountTile();
    await iframe(w).trigger("load");
    expect(w.html()).toMatchInlineSnapshot(`
      "<div data-v-93044b1c="">
        <div data-v-93044b1c="" object="[object Object]">
          <div data-v-93044b1c="" id="meeting-room" class="frame" style="width: 640px; height: 360px;">
            <!--
                  Use the same small spinner GIF as the individual-stream tile
                  (Yourself.vue / Jitsi.vue). The previous \`<Loading />\` here
                  rendered \`/img/loading.svg\` at \`height: 100%\`, which briefly
                  painted a giant orange/cream striped square over the whole
                  meeting before the iframe finished loading.
                -->
            <!--v-if-->
            <!--v-if--><iframe data-v-93044b1c="" class="room" src="https://meet.test/room-1#config.prejoinPageEnabled=false&amp;config.prejoinConfig=%7B%22enabled%22%3Afalse%7D&amp;config.startVideoMuted=1&amp;config.startAudioMuted=1&amp;config.disableInitialGUM=true&amp;config.toolbarButtons=%5B%5D&amp;config.disableShortcuts=true&amp;config.readOnlyName=true&amp;config.disableDeepLinking=true&amp;config.disableInviteFunctions=true&amp;config.disableProfile=true&amp;config.disableReactions=true&amp;config.disableReactionsInChat=true&amp;config.disableModeratorIndicator=true&amp;config.disableRemoteMute=true&amp;config.disableSelfView=true&amp;config.disableSelfViewSettings=true&amp;config.disableLocalVideoFlip=true&amp;config.hiddenPremeetingButtons=%5B%22microphone%22%2C%22camera%22%2C%22select-background%22%2C%22invite%22%2C%22settings%22%5D&amp;config.filmstrip=%7B%22disableResizable%22%3Atrue%2C%22disableStageFilmstrip%22%3Atrue%7D&amp;config.remoteVideoMenu=%7B%22disabled%22%3Atrue%2C%22disableKick%22%3Atrue%2C%22disableGrantModerator%22%3Atrue%2C%22disablePrivateChat%22%3A%22all%22%2C%22disableDemote%22%3Atrue%7D&amp;config.participantsPane=%7B%22hideModeratorSettingsTab%22%3Atrue%2C%22hideMoreActionsButton%22%3Atrue%2C%22hideMuteAllButton%22%3Atrue%7D&amp;interfaceConfig.SHOW_CHROME_EXTENSION_BANNER=false&amp;interfaceConfig.TOOLBAR_BUTTONS=%5B%5D&amp;interfaceConfig.SETTINGS_SECTIONS=%5B%5D&amp;interfaceConfig.MOBILE_APP_PROMO=false&amp;interfaceConfig.SHARING_FEATURES=%5B%5D&amp;interfaceConfig.DISABLE_JOIN_LEAVE_NOTIFICATIONS=true&amp;userInfo.displayName=%22Tester%22" allow="autoplay" referrerpolicy="no-referrer-when-downgrade"></iframe>
          </div>
        </div>
      </div>"
    `);
  });

  it("failed to load", async () => {
    const w = mountTile();
    await iframe(w).trigger("error");
    expect(w.html()).toMatchInlineSnapshot(`
      "<div data-v-93044b1c="">
        <div data-v-93044b1c="" object="[object Object]">
          <div data-v-93044b1c="" id="meeting-room" class="frame" style="width: 640px; height: 360px;">
            <!--
                  Use the same small spinner GIF as the individual-stream tile
                  (Yourself.vue / Jitsi.vue). The previous \`<Loading />\` here
                  rendered \`/img/loading.svg\` at \`height: 100%\`, which briefly
                  painted a giant orange/cream striped square over the whole
                  meeting before the iframe finished loading.
                -->
            <!--v-if-->
            <div data-v-93044b1c="" class="failed">
              <p data-v-93044b1c=""><strong data-v-93044b1c="">Embedded meeting service is unavailable.</strong></p>
              <p data-v-93044b1c="" class="hint"> If you have a content blocker enabled (Brave Shields, uBlock Origin, Privacy Badger, Firefox Strict tracking protection, etc.), allow this page to embed <code data-v-93044b1c="">meet.test</code> and try again. </p><button data-v-93044b1c="" class="button is-small is-light" type="button">refresh_meeting</button>
            </div><iframe data-v-93044b1c="" class="room" src="https://meet.test/room-1#config.prejoinPageEnabled=false&amp;config.prejoinConfig=%7B%22enabled%22%3Afalse%7D&amp;config.startVideoMuted=1&amp;config.startAudioMuted=1&amp;config.disableInitialGUM=false&amp;interfaceConfig.SHOW_CHROME_EXTENSION_BANNER=false&amp;userInfo.displayName=%22Tester%22" allow="camera; microphone; display-capture; autoplay" allowfullscreen="" referrerpolicy="no-referrer-when-downgrade" style="display: none;"></iframe>
          </div>
        </div>
      </div>"
    `);
  });

  it("selected (pointer events off so the tile can be dragged)", () => {
    (useStageStore() as unknown as { activeMovable: unknown }).activeMovable = "m1";
    const w = mountTile();
    expect(w.find("#meeting-room").classes()).toEqual(["frame", "disable-pointer"]);
    (useStageStore() as unknown as { activeMovable: unknown }).activeMovable = false;
  });
});

describe("frozen: the component's template and stylesheet", () => {
  // Vitest runs from the project root.
  const source = readFileSync(
    resolve(process.cwd(), "src/components/objects/MeetingObject/index.vue"),
    "utf8",
  );
  const block = (tag: string) => {
    const start = source.indexOf(`<${tag}`);
    const end = source.lastIndexOf(`</${tag}>`);
    return source.slice(start, end + tag.length + 3);
  };

  it("template", () => {
    expect(block("template")).toMatchInlineSnapshot(`
      "<template>
        <div>
          <AppObject :object="meeting">
            <template #render>
              <div
                id="meeting-room"
                class="frame"
                :style="{ width: object.w + 'px', height: object.h + 'px' }"
                :class="activeMovable ? 'disable-pointer' : ''"
              >
                <!--
                  Use the same small spinner GIF as the individual-stream tile
                  (Yourself.vue / Jitsi.vue). The previous \`<Loading />\` here
                  rendered \`/img/loading.svg\` at \`height: 100%\`, which briefly
                  painted a giant orange/cream striped square over the whole
                  meeting before the iframe finished loading.
                -->
                <img v-if="loading" class="overlay" src="/img/videoloading.gif" />
                <div v-if="failed" class="failed">
                  <p><strong>Embedded meeting service is unavailable.</strong></p>
                  <p class="hint">
                    If you have a content blocker enabled (Brave Shields, uBlock Origin, Privacy Badger,
                    Firefox Strict tracking protection, etc.), allow this page to embed
                    <code>{{ iframeSrc.split("/")[2] }}</code> and try again.
                  </p>
                  <button class="button is-small is-light" type="button" @click="retryMeeting">
                    {{ $t("refresh_meeting") }}
                  </button>
                </div>
                <iframe
                  v-show="!failed"
                  :key="iframeKey"
                  class="room"
                  :src="iframeSrc"
                  :allow="iframeAllow"
                  :allowfullscreen="canPlay"
                  referrerpolicy="no-referrer-when-downgrade"
                  @load="onLoad"
                  @error="onError"
                />
              </div>
            </template>
            <template #menu="slotProps">
              <MeetingContextMenu :object="meeting" v-bind="slotProps" />
            </template>
          </AppObject>
        </div>
      </template>"
    `);
  });

  it("stylesheet", () => {
    expect(block("style")).toMatchInlineSnapshot(`
      "<style lang="scss" scoped>
      .frame {
        position: relative;
        border: 2px solid black;
        border-top: 10px solid #007011;
        border-radius: 8px;
        box-sizing: border-box;
        overflow: hidden;

        .room {
          width: 100%;
          height: 100%;
          border: 0;
          display: block;
        }
      }

      .disable-pointer {
        pointer-events: none;
      }

      // Mirrors the overlay rule in Yourself.vue / Jitsi.vue so the
      // buffering animation lands in the centre of the tile rather than
      // covering the whole iframe.
      .overlay {
        position: absolute;
        width: 40%;
        left: 30%;
        top: 50%;
        transform: translateY(-50%);
        z-index: 1;
        pointer-events: none;
      }

      .failed {
        padding: 16px;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        text-align: center;
        background-color: #fdedf6;

        .hint {
          font-size: 0.85rem;
          margin-top: 8px;
          code {
            font-family: monospace;
            background-color: rgba(0, 0, 0, 0.06);
            padding: 1px 4px;
            border-radius: 3px;
          }
        }
      }
      </style>"
    `);
  });
});
