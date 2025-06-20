import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';
import { useAttribute, useMutation } from 'services/graphql/composable';
import { stageGraph } from 'services/graphql';
import buildClient from 'services/mqtt';
import { namespaceTopic } from './reusable';
import { TOPICS } from 'constants/index';
import { message } from 'ant-design-vue';

export const useStageCustomizationStore = defineStore('stageCustomization', () => {
  const stage = ref(null);
  const refresh = ref(null);
  
  const config = useAttribute(stage, 'config', true).value ?? {
    ratio: {
      width: 16,
      height: 9,
    },
    animations: {
      bubble: 'fade',
      curtain: 'drop',
      bubbleSpeed: 1000,
      curtainSpeed: 5000,
    },
    defaultcolor: '#30AC45',
  };

  const selectedRatio = reactive(config.ratio);
  const animations = reactive(config.animations);
  const defaultcolor = ref(config.defaultcolor || '#30AC45');
  const saving = ref(false);

  const { loading: saving, save } = useMutation(stageGraph.saveStageConfig);

  const saveCustomisation = async () => {
    const config = JSON.stringify({
      ratio: selectedRatio,
      animations,
      defaultcolor: defaultcolor.value,
    });

    await save(
      () => {
        message.success('Customisation saved!');
        refresh.value(stage.value.id);
      },
      stage.value.id,
      config
    );

    const mqtt = buildClient();
    const client = mqtt.connect();
    
    return new Promise((resolve, reject) => {
      client.publish(
        namespaceTopic(TOPICS.BACKGROUND, stage.value.fileLocation),
        JSON.stringify({
          type: 'setBackdropColor',
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
        }
      );
    });
  };

  const sendBackdropColor = (color) => {
    defaultcolor.value = color;
  };

  const setStage = (newStage) => {
    stage.value = newStage;
  };

  const setRefresh = (newRefresh) => {
    refresh.value = newRefresh;
  };

  return {
    stage,
    refresh,
    selectedRatio,
    animations,
    defaultcolor,
    saving,
    saveCustomisation,
    sendBackdropColor,
    setStage,
    setRefresh,
  };
}); 