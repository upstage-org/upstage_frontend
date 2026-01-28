<template>
  <SaveButton
    class="mb-4"
    :loading="saving"
    @click="saveCustomisation"
    :disabled="!selectedRatio.width || !selectedRatio.height"
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
                  @change="animations.bubbleSpeed = 1000 / $event.target.value"
                  type="range"
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
                    label:
                      'Closes from the sides in and opens from the middle out',
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
                  @change="animations.curtainSpeed = 5000 / $event.target.value"
                  type="range"
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
          <Switch
            v-model="enabledLiveStreaming"
            :label="enabledLiveStreaming ? 'Enabled' : 'Disabled'"
          />
        </td>
      </tr>
      <tr>
        <td>
          <h3 class="title">{{ $t("default_backgroundcolor") }}</h3>
        </td>
        <td>
          <ColorPicker
            v-model="defaultcolor"
            @update:modelValue="sendBackdropColor"
          />
        </td>
      </tr>
      <tr>
        <td>
          <h3 class="title">
            Stage Ratio
            <span v-if="selectedRatio"
              >: {{ selectedRatio.width }}/{{ selectedRatio.height }}</span
            >
          </h3>
        </td>
        <td>
          <div class="columns">
            <div class="column is-3">
              <Selectable
                :selected="
                  selectedRatio.width == 4 && selectedRatio.height == 3
                "
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
                :selected="
                  selectedRatio.width == 16 && selectedRatio.height == 9
                "
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
                :selected="
                  selectedRatio.width == 2 && selectedRatio.height == 1
                "
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
                  'padding-bottom': `${
                    (selectedRatio.height * 100) / selectedRatio.width
                  }%`,
                }"
              >
                <div>
                  <div>Custom ratio:</div>
                  <div class="custom-ratio">
                    <input type="number" v-model="selectedRatio.width" />
                    /
                    <input type="number" v-model="selectedRatio.height" />
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

<script>
import { reactive, ref, watch, computed } from "vue";
import Selectable from "components/Selectable.vue";
import SaveButton from "components/form/SaveButton.vue";
import { message } from "ant-design-vue";
import { capitalize, inject } from "vue";
import HorizontalField from "components/form/HorizontalField.vue";
import Dropdown from "components/form/Dropdown.vue";
import Switch from "components/form/Switch.vue";
import { useAttribute, useMutation } from "services/graphql/composable";
import { stageGraph } from "services/graphql";
import ColorPicker from "components/form/ColorPicker.vue";
import { useStore } from "vuex";
import buildClient from "services/mqtt";
import { namespaceTopic } from "store/modules/stage/reusable";
import { BACKGROUND_ACTIONS, TOPICS } from "utils/constants";

export default {
  components: { Selectable, SaveButton, HorizontalField, Dropdown, Switch, ColorPicker },
  setup: () => {
    const stage = inject("stage");
    const refresh = inject("refresh");
    const store = useStore();
    const configAttribute = useAttribute(stage, "config", true);
    
    // Helper function to get default config
    const getDefaultConfig = () => ({
      ratio: {
        width: 16,
        height: 9,
      },
      animations: {
        bubble: "fade",
        curtain: "drop",
        bubbleSpeed: 1000,
        curtainSpeed: 5000,
      },
      defaultcolor: "#30AC45",
      enabledLiveStreaming: true,
    });

    const config = computed(() => {
      const savedConfig = configAttribute.value;
      return savedConfig ?? getDefaultConfig();
    });

    // Initialize reactive values from config
    const initialConfig = config.value;
    const selectedRatio = reactive({ 
      width: initialConfig.ratio?.width ?? 16, 
      height: initialConfig.ratio?.height ?? 9 
    });
    const animations = reactive({ 
      bubble: initialConfig.animations?.bubble ?? "fade",
      curtain: initialConfig.animations?.curtain ?? "drop",
      bubbleSpeed: initialConfig.animations?.bubbleSpeed ?? 1000,
      curtainSpeed: initialConfig.animations?.curtainSpeed ?? 5000,
    });
    const defaultcolor = ref(initialConfig.defaultcolor ?? "#30AC45");
    const enabledLiveStreaming = ref(
      typeof initialConfig.enabledLiveStreaming === 'boolean' 
        ? initialConfig.enabledLiveStreaming 
        : true
    );

    // Helper function to update all settings from config
    const updateSettingsFromConfig = (parsedConfig) => {
      if (!parsedConfig) return;
      
      // Update enabledLiveStreaming - explicitly check for boolean to preserve false values
      if (typeof parsedConfig.enabledLiveStreaming === 'boolean') {
        enabledLiveStreaming.value = parsedConfig.enabledLiveStreaming;
      }
      
      // Update defaultcolor - check if it exists (including empty string)
      // Always update if it's defined, even if it's an empty string
      if (parsedConfig.defaultcolor !== undefined && parsedConfig.defaultcolor !== null) {
        defaultcolor.value = parsedConfig.defaultcolor;
      }
      
      // Update ratio if it exists - update both properties explicitly
      if (parsedConfig.ratio) {
        if (typeof parsedConfig.ratio.width === 'number') {
          selectedRatio.width = parsedConfig.ratio.width;
        }
        if (typeof parsedConfig.ratio.height === 'number') {
          selectedRatio.height = parsedConfig.ratio.height;
        }
      }
      
      // Update animations if they exist - update all properties explicitly
      if (parsedConfig.animations) {
        if (parsedConfig.animations.bubble !== undefined) {
          animations.bubble = parsedConfig.animations.bubble;
        }
        if (parsedConfig.animations.curtain !== undefined) {
          animations.curtain = parsedConfig.animations.curtain;
        }
        if (typeof parsedConfig.animations.bubbleSpeed === 'number') {
          animations.bubbleSpeed = parsedConfig.animations.bubbleSpeed;
        }
        if (typeof parsedConfig.animations.curtainSpeed === 'number') {
          animations.curtainSpeed = parsedConfig.animations.curtainSpeed;
        }
      }
    };

    // Watch configAttribute directly to catch when the config is loaded/updated
    watch(configAttribute, (newConfigValue) => {
      updateSettingsFromConfig(newConfigValue);
    }, { immediate: true });
    
    // Also watch stage attributes to catch when stage is refreshed
    watch(() => stage.value?.attributes, (newAttributes) => {
      if (newAttributes) {
        const configAttr = newAttributes.find(a => a.name === 'config');
        if (configAttr?.description) {
          try {
            const parsedConfig = JSON.parse(configAttr.description);
            updateSettingsFromConfig(parsedConfig);
          } catch (e) {
            // Ignore parse errors
            console.error('Error parsing config:', e);
          }
        }
      }
    }, { deep: true });

    const { loading: saving, save } = useMutation(stageGraph.saveStageConfig);
    const saveCustomisation = async () => {
      // Ensure all settings are explicitly included in the config
      const configData = JSON.stringify({
        ratio: {
          width: selectedRatio.width,
          height: selectedRatio.height,
        },
        animations: {
          bubble: animations.bubble,
          curtain: animations.curtain,
          bubbleSpeed: animations.bubbleSpeed,
          curtainSpeed: animations.curtainSpeed,
        },
        defaultcolor: defaultcolor.value,
        enabledLiveStreaming: enabledLiveStreaming.value, // Explicitly include boolean value
      });
      
      try {
        await save(
          () => {
            message.success("Customisation saved!");
            // Small delay to ensure backend has processed the save before refreshing
            setTimeout(() => {
              refresh(stage.value.id);
            }, 200);
          },
          stage.value.id,
          configData,
          stage.value.visibility
        );
      } catch (error) {
        console.error('Error saving customisation:', error);
        message.error('Failed to save customisation. Please try again.');
      }
      const mqtt = buildClient();
      const client = mqtt.connect();
      client.publish(namespaceTopic(TOPICS.BACKGROUND, stage.value.fileLocation),
        JSON.stringify(
          {
            type: "setBackdropColor",
            color: defaultcolor.value,
          }),
          { qos: 1, retain: false },
          (error, res) => {
            if (error) {
              console.error("MQTT publish error:", error);
            } else {
              console.log("MQTT publish success:", res);
              mqtt.disconnect();
            }
          }
        );
    };

    const sendBackdropColor = (color) => {
      defaultcolor.value = color;
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
    };
  },
};
</script>

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

.title {
  white-space: nowrap;
  font-size: 1.3rem;
}

td {
  padding: 8px;
}
</style>