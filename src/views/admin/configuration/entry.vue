<script setup lang="ts">
import { useLoading } from "hooks/mutations";
import { VNode, ref, watch } from "vue";
import RichTextEditor from "components/editor/RichTextEditor.vue";
import { configGraph } from "services/graphql";

const props = defineProps<{
  name: string;
  label: string;
  defaultValue: string | boolean;
  multiline?: boolean;
  richTextEditor?: boolean;
  help?: VNode;
  refresh?: () => Promise<void>;
}>();

const editing = ref(false);
const value = ref(props.defaultValue);

watch(
  () => props.defaultValue,
  (next) => {
    value.value = next;
  },
);

const { loading, proceed } = useLoading(
  async () => configGraph.saveConfig(props.name, value.value),
  {
    loading: "Saving configuration…",
    success: () => "Configuration saved",
    error: (error) => {
      const maybe = error as
        | { response?: { errors?: Array<{ message?: string }> }; message?: string }
        | undefined;
      return (
        maybe?.response?.errors?.[0]?.message ?? maybe?.message ?? "Failed to save configuration"
      );
    },
  },
);

const save = async (checked?: boolean) => {
  const previous = value.value;
  if (typeof checked === "boolean") {
    value.value = checked;
  }
  editing.value = false;
  const result = await proceed();
  if (result === undefined) {
    value.value = previous;
    return;
  }
  if (props.refresh) {
    await props.refresh();
  }
};
</script>

<template>
  <a-form-item
    :label="props.label"
    :name="name"
    :label-col="{ span: 12, xl: { span: 4 }, xxl: { span: 3 } }"
  >
    <template v-if="typeof value === 'string'">
      <a-input-group compact style="display: flex; width: 100%; align-items: flex-start">
        <RichTextEditor
          v-if="richTextEditor"
          v-model="value"
          class="min-w-0 flex-1"
          :readonly="!editing"
          :style="{
            boxShadow: 'none',
            pointerEvents: editing ? 'auto' : 'none',
          }"
        />
        <template v-else>
          <a-textarea
            v-if="props.multiline"
            v-model:value="value"
            :disabled="!editing"
            style="color: black"
            auto-size
          ></a-textarea>
          <a-input v-else v-model:value="value" :disabled="!editing" style="color: black" />
        </template>
        <a-button v-if="!editing && !loading" type="primary" @click="editing = true">Edit</a-button>
        <a-button v-else type="primary" :loading="loading" @click="save">Save</a-button>
      </a-input-group>
    </template>
    <a-switch
      v-if="typeof value === 'boolean'"
      v-model:checked="value"
      :loading="loading"
      @change="save"
    />
    <help v-if="help" class="mt-2" />
  </a-form-item>
</template>
