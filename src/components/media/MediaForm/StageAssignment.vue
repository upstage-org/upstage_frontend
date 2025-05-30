<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import gql from "graphql-tag";
import { ref, computed, watchEffect, PropType } from "vue";
import { StudioGraph } from "models/studio";
import { TransferItem } from "ant-design-vue/lib/transfer";
import store from "store";

const props = defineProps({
  modelValue: {
    type: Array as PropType<string[]>,
    required: true,
  },
});

const emits = defineEmits(["update:modelValue"]);
const isAdmin = computed(() => store.getters["user/isAdmin"]);

const { result, loading } = useQuery(
  gql`
  {
    getAllStages {
        id
        name
        permission
      }
  }
  `,
  null,
  { fetchPolicy: "cache-and-network" },
);
const stages = computed(() => {
  if (result.value?.getAllStages) {
    return result.value.getAllStages.filter((el: any) => isAdmin.value ? true : (el.permission == "editor" || el.permission == "owner"))
      .map(({ id, name }: any) => ({ key: id, name }));
  }
  return [];
});

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
