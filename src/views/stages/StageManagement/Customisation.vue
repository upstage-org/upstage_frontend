<script>
import { reactive, ref } from "vue";
import Selectable from "components/Selectable.vue";
import SaveButton from "components/form/SaveButton.vue";
import { message } from "ant-design-vue";
import { capitalize, inject } from "vue";
import HorizontalField from "components/form/HorizontalField.vue";
import Dropdown from "components/form/Dropdown.vue";
// Aliased: "Switch" is a reserved HTML element name (vue/no-reserved-component-names).
import AppSwitch from "components/form/Switch.vue";
import { useAttribute, useMutation } from "services/graphql/composable";
import { stageGraph } from "services/graphql";
import ColorPicker from "components/form/ColorPicker.vue";
import buildClient from "services/mqtt";
import { namespaceTopic } from "store/modules/stage/reusable";
import { TOPICS } from "utils/constants";
import { coerceNumber, endpointHostLabel } from "utils/common";
import configs from "config";

export default {
  components: { Selectable, SaveButton, HorizontalField, Dropdown, AppSwitch, ColorPicker },
  setup: () => {
    const stage = inject("stage");
    const refresh = inject("refresh");
    const config = useAttribute(stage, "config", true).value ?? {
      ratio: {
        width: 16,
        height: 9,
      },
      animations: {
        bubble: "fade",
        curtain: "drop",
        bubbleSpeed: 1800,
        curtainSpeed: 9100,
      },
      defaultcolor: "#30AC45",
      enabledLiveStreaming: true,
      streamingMode: "both",
    };

    const selectedRatio = reactive(config.ratio);
    // Seed defaults first so stages whose saved config predates a key show
    // real values instead of blank fields; saved values win via the spread.
    // `removal`/`removalSpeed` are dead keys: exit animations are set per
    // stage assignment (media editor Stages tab / Stage Management > Media)
    // and the board no longer reads a stage-wide fallback. Old saved values
    // just ride along in the spread, ignored.
    const animations = reactive({
      bubble: "fade",
      curtain: "drop",
      bubbleSpeed: 1800,
      curtainSpeed: 9100,
      ...(config.animations ?? {}),
    });
    const defaultcolor = ref(config.defaultcolor || "#30AC45");
    const enabledLiveStreaming = ref(config.enabledLiveStreaming ?? true);
    // Which transports "Live Streaming" enables: Jitsi rooms, RTMP feeds, or
    // both. Legacy configs predate the field, and their enabled state always
    // meant both, so default accordingly.
    const streamingMode = ref(
      ["jitsi", "rtmp", "both"].includes(config.streamingMode) ? config.streamingMode : "both",
    );
    // Multi-server streaming: the Jitsi server pre-selected for performers on
    // this stage ("" = first configured server). Only offered when the build
    // lists more than one server; a saved value that is no longer configured
    // falls back to "" so the dropdown never shows a phantom entry.
    const jitsiServers = configs.JITSI_ENDPOINTS ?? [];
    const jitsiServerOptions = [
      { value: "", label: "First configured server" },
      ...jitsiServers.map((origin) => ({ value: origin, label: endpointHostLabel(origin) })),
    ];
    const showJitsiServerPicker = (configs.JITSI_SERVER_COUNT ?? 1) > 1;
    const jitsiServer = ref(
      typeof config.jitsiServer === "string" && jitsiServers.includes(config.jitsiServer)
        ? config.jitsiServer
        : "",
    );
    const configuredServers = {
      jitsi: configs.JITSI_SERVER_COUNT ?? 1,
      rtmp: configs.RTMP_SERVER_COUNT ?? (configs.RTMP_ENDPOINT ? 1 : 0),
    };

    const { loading: saving, save } = useMutation(stageGraph.saveStageConfig);
    const saveCustomisation = async () => {
      const configData = JSON.stringify({
        ratio: selectedRatio,
        animations,
        defaultcolor: defaultcolor.value,
        enabledLiveStreaming: enabledLiveStreaming.value,
        streamingMode: streamingMode.value,
        // Only persisted when a specific server is chosen (single-server
        // installs keep the exact config shape they had).
        ...(jitsiServer.value ? { jitsiServer: jitsiServer.value } : {}),
      });
      await save(
        () => {
          message.success("Customisation saved!");
          refresh(stage.value.id);
        },
        stage.value.id,
        configData,
      );
      const mqtt = buildClient();
      const client = mqtt.connect(stage.value?.mqtt);
      if (!client) return;
      client.publish(
        namespaceTopic(TOPICS.BACKGROUND, stage.value.fileLocation),
        JSON.stringify({
          type: "setBackdropColor",
          color: defaultcolor.value,
        }),
        { qos: 1, retain: false },
        (error, res) => {
          if (error) {
            reject(error);
          } else {
            resolve(res);
            mqtt.disconnect();
          }
        },
      );
    };

    const sendBackdropColor = (color) => {
      defaultcolor.value = color;
    };

    // Custom-ratio number inputs need cross-browser coercion: Firefox lets
    // the user type non-integer / negative values that Chromium rejects.
    // Fall back to 1 (the smallest sensible ratio component) when the
    // input is empty or unparseable so the SaveButton's disabled-guard
    // (`!selectedRatio.width || !selectedRatio.height`) stays meaningful.
    const setRatioWidth = (e) => {
      selectedRatio.width = coerceNumber(e.target.value, { min: 1, step: 1 }) ?? 1;
    };
    const setRatioHeight = (e) => {
      selectedRatio.height = coerceNumber(e.target.value, { min: 1, step: 1 }) ?? 1;
    };

    return {
      selectedRatio,
      saving,
      saveCustomisation,
      animations,
      capitalize,
      defaultcolor,
      sendBackdropColor,
      enabledLiveStreaming,
      streamingMode,
      jitsiServer,
      jitsiServerOptions,
      showJitsiServerPicker,
      configuredServers,
      setRatioWidth,
      setRatioHeight,
    };
  },
};
</script>

<template>
  <SaveButton
    class="mb-4"
    :loading="saving"
    :disabled="!selectedRatio.width || !selectedRatio.height"
    @click="saveCustomisation"
  />
  <table class="is-fullwidth" cellspacing="5">
    <tbody>
      <tr>
        <td>
          <h3 class="title">{{ $t("animations") }}</h3>
        </td>
        <td width="100%">
          <div>
            <HorizontalField title="Speech bubble">
              <Dropdown
                v-model="animations.bubble"
                :data="['fade', 'bounce']"
                :render-label="capitalize"
              />
            </HorizontalField>
            <HorizontalField title="Speed">
              <div class="speed-slider">
                <span class="mr-2">{{ $t("slow") }}</span>
                <input
                  class="slider is-fullwidth"
                  step="0.01"
                  min="0.1"
                  max="1"
                  :value="1000 / animations.bubbleSpeed"
                  type="range"
                  @change="animations.bubbleSpeed = 1000 / $event.target.value"
                />
                <span class="ml-2">{{ $t("fast") }}</span>
              </div>
            </HorizontalField>
            <HorizontalField title="Curtain">
              <Dropdown
                v-model="animations.curtain"
                :data="[
                  { value: 'drop', label: 'Drops down and lifts up' },
                  { value: 'fade', label: 'Fades in and out' },
                  {
                    value: 'close',
                    label: 'Closes from the sides in and opens from the middle out',
                  },
                ]"
                :render-value="(item) => item.value"
                :render-label="(item) => item.label"
              />
            </HorizontalField>
            <HorizontalField title="Speed">
              <div class="speed-slider">
                <span class="mr-2">{{ $t("slow") }}</span>
                <input
                  class="slider is-fullwidth"
                  step="0.01"
                  min="0.1"
                  max="1"
                  :value="5000 / animations.curtainSpeed"
                  type="range"
                  @change="animations.curtainSpeed = 5000 / $event.target.value"
                />
                <span class="ml-2">{{ $t("fast") }}</span>
              </div>
            </HorizontalField>
          </div>
        </td>
      </tr>
      <tr>
        <td>
          <h3 class="title">{{ $t("live_streaming") }}</h3>
        </td>
        <td>
          <div class="streaming-controls">
            <AppSwitch
              v-model="enabledLiveStreaming"
              :label="enabledLiveStreaming ? 'Enabled' : 'Disabled'"
            />
            <Dropdown
              v-if="enabledLiveStreaming"
              v-model="streamingMode"
              :data="[
                { value: 'both', label: 'Jitsi + RTMP' },
                { value: 'jitsi', label: 'Jitsi only' },
                { value: 'rtmp', label: 'RTMP only' },
              ]"
              :render-value="(item) => item.value"
              :render-label="(item) => item.label"
            />
            <Dropdown
              v-if="enabledLiveStreaming && streamingMode !== 'rtmp' && showJitsiServerPicker"
              v-model="jitsiServer"
              :data="jitsiServerOptions"
              :render-value="(item) => item.value"
              :render-label="(item) => item.label"
              :title="$t('jitsi_server_default_hint')"
            />
          </div>
          <p v-if="enabledLiveStreaming" class="configured-servers">
            {{ $t("configured_servers", configuredServers) }}
          </p>
        </td>
      </tr>
      <tr>
        <td>
          <h3 class="title">{{ $t("default_backgroundcolor") }}</h3>
        </td>
        <td>
          <ColorPicker v-model="defaultcolor" @update:model-value="sendBackdropColor" />
        </td>
      </tr>
      <tr>
        <td>
          <h3 class="title">
            Stage Ratio
            <span v-if="selectedRatio">: {{ selectedRatio.width }}/{{ selectedRatio.height }}</span>
          </h3>
        </td>
        <td>
          <div class="columns">
            <div class="column is-3">
              <Selectable
                :selected="selectedRatio.width == 4 && selectedRatio.height == 3"
                @select="
                  selectedRatio.width = 4;
                  selectedRatio.height = 3;
                "
              >
                <div class="box size-option" style="padding-bottom: 75%">
                  <div>4/3</div>
                </div>
              </Selectable>
            </div>
            <div class="column is-3">
              <Selectable
                :selected="selectedRatio.width == 16 && selectedRatio.height == 9"
                @select="
                  selectedRatio.width = 16;
                  selectedRatio.height = 9;
                "
              >
                <div class="box size-option" style="padding-bottom: 56.25%">
                  <div>16/9</div>
                </div>
              </Selectable>
            </div>
            <div class="column is-3">
              <Selectable
                :selected="selectedRatio.width == 2 && selectedRatio.height == 1"
                @select="
                  selectedRatio.width = 2;
                  selectedRatio.height = 1;
                "
              >
                <div class="box size-option" style="padding-bottom: 50%">
                  <div>2/1</div>
                </div>
              </Selectable>
            </div>
            <div class="column is-3">
              <div
                class="box size-option has-primary-background"
                :style="{
                  'padding-bottom': `${(selectedRatio.height * 100) / selectedRatio.width}%`,
                }"
              >
                <div>
                  <div>Custom ratio:</div>
                  <div class="custom-ratio">
                    <input
                      :value="selectedRatio.width"
                      type="number"
                      inputmode="numeric"
                      min="1"
                      step="1"
                      @input="setRatioWidth"
                      @blur="setRatioWidth"
                    />
                    /
                    <input
                      :value="selectedRatio.height"
                      type="number"
                      inputmode="numeric"
                      min="1"
                      step="1"
                      @input="setRatioHeight"
                      @blur="setRatioHeight"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style lang="scss" scoped>
.size-option {
  width: 100%;
  height: 0;
  padding: 0;
  position: relative;

  > div {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
  }
}

.custom-ratio {
  white-space: nowrap;

  input {
    width: 50px;
    text-align: center;
  }
}

.speed-slider {
  display: flex;
  align-items: center;
}

.streaming-controls {
  display: flex;
  align-items: center;
  gap: 16px;
}

.configured-servers {
  margin-top: 6px;
  font-size: 0.85rem;
  opacity: 0.75;
}

.title {
  white-space: nowrap;
  font-size: 1.3rem;
}

td {
  padding: 8px;
}
</style>
