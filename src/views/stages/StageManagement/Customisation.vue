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
import { coerceNumber } from "utils/common";
import { REMOVAL_ANIMATION_OPTIONS } from "components/stage/removalAnimations";

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
        removal: "spiral",
        removalSpeed: 1000,
      },
      defaultcolor: "#30AC45",
      enabledLiveStreaming: true,
      streamingMode: "both",
    };

    const selectedRatio = reactive(config.ratio);
    // Seed defaults first so stages whose saved config predates a key show
    // real values instead of blank fields; saved values win via the spread.
    const animations = reactive({
      bubble: "fade",
      curtain: "drop",
      bubbleSpeed: 1800,
      curtainSpeed: 9100,
      removal: "spiral",
      removalSpeed: 1000,
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

    const { loading: saving, save } = useMutation(stageGraph.saveStageConfig);
    const saveCustomisation = async () => {
      const configData = JSON.stringify({
        ratio: selectedRatio,
        animations,
        defaultcolor: defaultcolor.value,
        enabledLiveStreaming: enabledLiveStreaming.value,
        streamingMode: streamingMode.value,
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
      const client = mqtt.connect();
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
      removalOptions: REMOVAL_ANIMATION_OPTIONS,
      capitalize,
      defaultcolor,
      sendBackdropColor,
      enabledLiveStreaming,
      streamingMode,
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
            <HorizontalField title="Removal effect">
              <Dropdown
                v-model="animations.removal"
                :data="removalOptions"
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
                  :value="1000 / animations.removalSpeed"
                  type="range"
                  @change="animations.removalSpeed = 1000 / $event.target.value"
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
          </div>
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

.title {
  white-space: nowrap;
  font-size: 1.3rem;
}

td {
  padding: 8px;
}
</style>
