<template>
  <div id="connection-status">
    <ReloadStream />
    <span class="tag is-light is-small" :class="{
      'is-danger': status === 'LIVE',
      'is-warning': status === 'CONNECTING',
      'is-rehearsal': status === 'REHEARSAL'
    }">
      <template v-if="replaying">
        <span class="icon">
          <i ref="dot" class="fas fa-circle"></i>
        </span>
        <span class="status-text">{{ $t("replaying") }}</span>
      </template>
      <template v-else>
        <span class="icon" v-show="masquerading || status !== 'OFFLINE'">
          <i ref="dot" class="fas fa-circle"></i>
        </span>
        <span class="icon" v-show="status === 'OFFLINE'">
          <i class="far fa-circle"></i>
        </span>
        <span class="status-text">{{ masquerading ? "REHEARSAL" : status }}</span>
      </template>
    </span>

    <Popover>
      <template #trigger>
        <span class="tag is-dark is-small">
          <span class="icon">
            <i class="fas fa-user"></i>
          </span>
          <span>{{ players.length }}</span>
          <span class="icon">
            <i class="fas fa-desktop"></i>
          </span>
          <span>{{ audiences.length }}</span>
        </span>
      </template>
      <div style="max-height: 50vh; overflow-y: auto">
        <Session v-for="player in players" :key="player" :session="player" />
        <Session v-for="audience in audiences" :key="audience" :session="audience" />
      </div>
    </Popover>
  </div>
</template>

<script>
import { useStore } from "vuex";
import { animate } from "animejs";
import { ref, computed, onMounted, inject, nextTick, watch } from "vue";
import Popover from "components/Popover.vue";
import Session from "./Session.vue";
import ReloadStream from "./ReloadStream.vue";

export default {
  components: { Popover, Session, ReloadStream },
  setup: () => {
    const store = useStore();
    const dot = ref();
    const status = computed(() => {
      if (store.state.stage?.model?.status == 'rehearsal') {
        return 'REHEARSAL'
      }
      return store.state.stage.status
    });
    const players = computed(() => store.getters["stage/players"]);
    const audiences = computed(() => store.getters["stage/audiences"]);
    const masquerading = computed(() => store.state.stage.masquerading);
    const replaying = inject("replaying");

    const startAnimation = () => {
      // Check if element exists, is an HTMLElement, and is actually visible/accessible
      if (!dot.value) return;
      
      const element = dot.value instanceof HTMLElement 
        ? dot.value 
        : (dot.value.$el instanceof HTMLElement ? dot.value.$el : null);
      
      if (!element) return;
      
      // Check if element is actually in the DOM
      if (!element.isConnected || !document.body.contains(element)) return;
      
      // Check if element is visible (not hidden by v-show or CSS)
      const computedStyle = window.getComputedStyle(element);
      if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden' || computedStyle.opacity === '0') {
        return;
      }
      
      // Check if element has dimensions (is visible, not hidden by v-show)
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      
      // Additional check: element must be visible in viewport
      if (rect.top < 0 || rect.left < 0) return;
      
      // Verify the element is actually the one we want to animate
      // Check if it's the correct icon element (fa-circle, not fa-circle-o)
      if (!element.classList || !element.classList.contains('fa-circle')) {
        return;
      }
      
      try {
        animate(element, {
          opacity: [1, 0, 1],
          duration: 2000,
          loop: true,
        });
      } catch (error) {
        // Silently handle animation errors if element is not accessible
        // Don't log to avoid console noise
        return;
      }
    };

    onMounted(() => {
      nextTick(() => {
        // Only start animation if the element should be visible
        const isConnected = status.value !== 'OFFLINE' || masquerading.value;
        if (isConnected || replaying?.value) {
          startAnimation();
        }
      });
    });

    // Watch for status changes to restart animation when element becomes visible
    watch([status, masquerading], () => {
      // Add a delay to ensure v-show has updated the DOM and element is accessible
      setTimeout(() => {
        nextTick(() => {
          // Only start animation if the element should be visible
          const isConnected = status.value !== 'OFFLINE' || masquerading.value;
          if (isConnected || replaying?.value) {
            startAnimation();
          }
        });
      }, 100);
    });

    return {
      status,
      dot,
      players,
      audiences,
      replaying,
      masquerading
    };
  },
};
</script>

<style scoped lang="scss">
#connection-status {
  position: fixed;
  right: 12px;
  top: 50px;
  width: 250px;
  text-align: center;
  z-index: 4;

  @media screen and (max-width: 767px) {
    right: unset;
    top: 8px;
    left: 0;
  }
}

.is-rehearsal {
  background-color: #feecf0 !important;
  color: #0000ff !important;
}

.status-text {
  margin-top: 4px;
}
</style>
