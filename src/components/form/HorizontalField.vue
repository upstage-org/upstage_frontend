<script>
export default {
  props: { title: String },
};
</script>

<template>
  <div class="field is-horizontal">
    <div class="field-label is-normal">
      <label class="label">{{ title }}</label>
    </div>
    <div class="field-body">
      <div class="field">
        <slot />
      </div>
    </div>
  </div>
</template>

<style></style>
