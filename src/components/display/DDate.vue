<script lang="ts" setup>
import { computed } from "vue";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { Tooltip } from "ant-design-vue";

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(localizedFormat);

const { value } = defineProps<{
  value: Date | string;
}>();

const text = computed(() => dayjs.utc(value).fromNow());
const localFormatted = computed(() => dayjs(value).format("lll"));
</script>

<template>
  <Tooltip :title="localFormatted" class="cursor-help">
    {{ text }}
  </Tooltip>
</template>
