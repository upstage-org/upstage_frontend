<template>
  <div ref="el" :style="{
    position: 'absolute',
    opacity: object.opacity * (isDragging ? 0.5 : 1),
    filter: `grayscale(${object.liveAction ? 0 : 1})`,
    'transform-origin': transformOrigin,
  }" @mousedown="clickInside" v-click-outside="clickOutside">
    <slot />
  </div>
  <div v-if="isDragging" :style="{
    position: 'absolute',
    left: object.x + 'px',
    top: object.y + 'px',
    width: object.w + 'px',
    height: object.h + 'px',
    transform: `rotate(${object.rotate}deg)`,
    opacity: object.opacity,
    filter: `grayscale(${object.liveAction ? 0 : 1})`,
  }">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import Moveable from "moveable";
import { useStageStore } from "store/modules/stage";
import { animate } from "animejs";

interface Props {
  object: {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rotate: number;
    opacity: number;
    liveAction: boolean;
    type: string;
    wornBy?: string;
    moveSpeed?: number;
    scaleX?: number;
    scaleY?: number;
  };
  controlable?: boolean;
  active?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  controlable: false,
  active: false
});

const emit = defineEmits<{
  (e: 'update:active', value: boolean): void;
}>();

const el = ref<HTMLElement | null>(null);
const isDragging = ref(false);
const stageStore = useStageStore();

const canPlay = computed(() => stageStore.canPlay);
const config = computed(() => stageStore.config);
const moveable = new Moveable(document.body, {
  draggable: true,
  resizable: true,
  rotatable: true,
  origin: false,
});

let animation: any;

const sendMovement = (target: HTMLElement | SVGElement, { left, top }: { left: number; top: number }) => {
  target.style.left = `${props.object.x}px`;
  target.style.top = `${props.object.y}px`;
  stageStore.shapeObject({
    ...props.object,
    x: left,
    y: top,
  });
};

moveable
  .on("dragStart", () => {
    isDragging.value = true;
    if (animation) {
      animation.pause(true);
    }
  })
  .on("drag", ({ target, left, top }) => {
    target.style.left = `${left}px`;
    target.style.top = `${top}px`;
  })
  .on("dragEnd", ({ lastEvent, target }) => {
    if (lastEvent) {
      sendMovement(target, lastEvent);
    }
    isDragging.value = false;
  });

const sendResize = (target: HTMLElement | SVGElement, { width, height, left, top }: { width: number; height: number; left: number; top: number }) => {
  stageStore.shapeObject({
    ...props.object,
    x: left,
    y: top,
    w: width,
    h: height,
  });
};

moveable
  .on("resizeStart", () => {
    isDragging.value = true;
    if (animation) {
      animation.pause(true);
    }
  })
  .on("resize", ({ target, width, height, drag: { left, top } }) => {
    target.style.width = `${width}px`;
    target.style.height = `${height}px`;
    target.style.left = `${left}px`;
    target.style.top = `${top}px`;
  })
  .on(
    "resizeEnd",
    ({
      target,
      lastEvent: {
        width,
        height,
        drag: { left, top },
      },
    }) => {
      sendResize(target, { left, top, width, height });
      isDragging.value = false;
    },
  );

const sendRotation = (target: HTMLElement | SVGElement, rotate: number) => {
  target.style.transform = `rotate(${props.object.rotate}deg)`;
  stageStore.shapeObject({
    ...props.object,
    rotate,
  });
};

moveable
  .on("rotateStart", (e) => {
    e.set(props.object.rotate ?? 0);
    isDragging.value = true;
    if (animation) {
      animation.pause(true);
    }
  })
  .on("rotate", ({ target, rotate }) => {
    target.style.transform = `rotate(${rotate}deg)`;
  })
  .on("rotateEnd", ({ target, lastEvent: { rotate } }) => {
    sendRotation(target, rotate);
    isDragging.value = false;
  });

const showControls = (isShowing: boolean, e?: MouseEvent) => {
  if (moveable && el.value) {
    if (isShowing) {
      moveable.setState(
        {
          target: el.value,
          keepRatio: !["text", "meeting"].includes(props.object.type),
        },
        () => {
          if (e && props.object.type !== "text") {
            moveable.dragStart(e);
          }
        },
      );
      emit("update:active", true);
    } else {
      moveable.setState(
        {
          keepRatio: !["text", "meeting"].includes(props.object.type),
        },
        () => {
          emit("update:active", false);
        },
      );
    }
  }
};

const activeMovable = computed(
  () => stageStore.activeMovable === props.object.id,
);

const clickInside = (e: MouseEvent) => {
  if (props.controlable && canPlay.value) {
    showControls(true, e);
    stageStore.setActiveMovable(props.object.id);
  }
};

const clickOutside = (e?: MouseEvent) => {
  if (
    (!e || (e.target as HTMLElement).id === "board") &&
    props.controlable &&
    canPlay.value
  ) {
    stageStore.setActiveMovable(null);
  }
};

watch(
  activeMovable,
  (val) => {
    showControls(val);
  },
  { immediate: true },
);

watch(
  () => props.object,
  () => {
    if (!el.value) return;

    const {
      x: left,
      y: top,
      w: width,
      h: height,
      rotate,
      moveSpeed,
      opacity,
      scaleX = 1,
      scaleY = 1,
    } = props.object;
    if (animation) {
      animation.pause(true);
    }
    animation = animate(el.value, {
      left,
      top,
      width,
      height,
      rotate,
      opacity,
      scaleX,
      scaleY,
      ...(moveSpeed && moveSpeed > 1000 ? { easing: "linear" } : {}),
      duration: moveSpeed ?? config.value.animateDuration,
      onUpdate: () => {
        try {
          moveable.updateRect();
        } catch (error) {
          // pass
        }
      },
    });
  },
  { deep: true },
);

onMounted(() => {
  if (!el.value) return;

  const { x, y, w, h, rotate } = props.object;
  el.value.style.width = `${w}px`;
  el.value.style.height = `${h}px`;
  el.value.style.left = `${x}px`;
  el.value.style.top = `${y}px`;
  el.value.style.transform = `rotate(${rotate}deg)`;
});

onUnmounted(() => {
  moveable.destroy();
});

const transformOrigin = computed(() => {
  const wearer = stageStore.board.objects.find(
    (a) => a.id === props.object.wornBy,
  );
  if (wearer) {
    return `${wearer.x + wearer.w / 2 - props.object.x}px ${wearer.y + wearer.h / 2 - props.object.y
      }px`;
  } else {
    return "center";
  }
});
</script>

<style></style>
