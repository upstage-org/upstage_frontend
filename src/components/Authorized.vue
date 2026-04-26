<script lang="ts" setup>
/**
 * Wraps the slot in a <Suspense> so async children render with a fallback
 * spinner. The original "quick login" affordance and `authUser` mutation were
 * removed because their entire <a-result v-else> branch was commented out
 * in the template, making the script side dead code.
 */
</script>

<template>
  <suspense>
    <template #fallback>
      <a-spin />
    </template>
    <slot></slot>
  </suspense>
</template>
