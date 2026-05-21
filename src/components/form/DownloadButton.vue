<script>
export default {
  props: { loading: Boolean },
};
</script>

<template>
  <button class="button is-primary" :class="{ 'is-loading': loading }" v-bind="$attrs">
    <slot>
      <span class="icon is-small">
        <i class="fas fa-download"></i>
      </span>
      <span>{{ $t("download") }}</span>
    </slot>
  </button>
</template>

<style scoped>
.button {
  margin-left: auto;
  display: block;
}
</style>
