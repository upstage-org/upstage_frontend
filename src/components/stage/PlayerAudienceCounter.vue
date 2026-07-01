<script>
// Presentational only. Counts come from the stage-list GraphQL query
// (backend aggregates them from retained MQTT statistics via the
// upstage_stats worker). This deliberately does NOT open an MQTT client:
// one broker WebSocket per list row caused connect/disconnect churn on
// every search keystroke (connack timeouts + collateral ERR_NETWORK_CHANGED).
export default {
  props: {
    players: { type: Number, default: 0 },
    audiences: { type: Number, default: 0 },
  },
};
</script>

<template>
  <span v-if="players > 0 || audiences > 0" class="tag is-dark is-small">
    <span class="icon">
      <i class="fas fa-user"></i>
    </span>
    <span>{{ players }}</span>
    <span class="icon">
      <i class="fas fa-desktop"></i>
    </span>
    <span>{{ audiences }}</span>
  </span>
</template>

<style></style>
