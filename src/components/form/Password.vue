<script setup lang="ts">
import { ref } from "vue";
import Field from "./Field.vue";

const showPassword = ref(false);
</script>

<template>
  <Field v-bind="$attrs" :type="showPassword ? 'text' : 'password'" right="fas fa-eye">
    <template #right>
      <a className="icon is-small is-right clickable" @click="() => (showPassword = !showPassword)">
        <i :class="`fas fa-${showPassword ? 'eye-slash' : 'eye'}`"></i>
      </a>
    </template>
  </Field>
</template>

<style></style>
