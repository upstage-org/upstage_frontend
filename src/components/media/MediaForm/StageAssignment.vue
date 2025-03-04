<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import gql from "graphql-tag";
import { ref, computed, watchEffect, PropType } from "vue";
import { StudioGraph } from "models/studio";
import { TransferItem } from "ant-design-vue/lib/transfer";
import { useStore } from "vuex";
import configs from "config";

const props = defineProps({
  modelValue: {
    type: Array as PropType<string[]>,
    required: true,
  },
});

const emits = defineEmits(["update:modelValue"]);
const store = useStore();
const whoami = computed(() => store.getters["user/whoami"]);
const isAdmin = computed(
  () =>
    whoami.value &&
    [String(configs.ROLES.ADMIN), String(configs.ROLES.SUPER_ADMIN)].includes(String(whoami.value.role)),
);

const { result, loading } = useQuery(isAdmin ?
  gql`
  {
    stages(input:{}) {
        edges {
          id
          name
        }
      }
  }
  `:
  gql`
  query filterStages(
      $owners: [String]
    )
    {
      stages(input:{
        owners: $owners
      }) {
        edges {
          id
          name
        }
      }
    }
  `,
  { owners: [whoami.value.username] },
  { fetchPolicy: "cache-and-network" },
);
const stages = computed(() => {
  if (result.value?.stages) {
    return result.value.stages.edges
      .map(({ id, name }: any) => ({ key: id, name }));
  }
  return [];
});
console.log("=====result", result)
const targetKeys = ref(props.modelValue);
const filterOption = (inputValue: string, option: TransferItem) => {
  return option.name.toLowerCase().indexOf(inputValue.toLowerCase()) > -1;
};

watchEffect(() => {
  emits("update:modelValue", targetKeys.value);
});

watchEffect(() => {
  targetKeys.value = props.modelValue;
});

const renderItem = (item: TransferItem) => item.name;
</script>

<template>
  <a-transfer :locale="{
    itemUnit: 'stage',
    itemsUnit: 'stages',
    notFoundContent: 'No stage available',
    searchPlaceholder: 'Search stage name',
  }" :list-style="{
    flex: '1',
    height: '300px',
  }" :titles="[' available', ' assigned']" v-model:target-keys="targetKeys" :data-source="stages as any" show-search
    :filter-option="filterOption" :render="renderItem" />
</template>
