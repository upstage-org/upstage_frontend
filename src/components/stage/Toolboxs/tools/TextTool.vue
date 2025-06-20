<template>
  <section v-show="isWriting" class="writing" @click="onClickWriting" :style="{
    width: stageSize.width + 'px',
    height: stageSize.height + 'px',
    top: stageSize.top + 'px',
    left: stageSize.left + 'px',
  }">
    <p ref="el" :style="options" contenteditable="true">
      Write or paste
      <br />your text here
    </p>
  </section>
  <template v-if="!isWriting">
    <div @click="createText" class="text-tool">
      <div class="icon is-large">
        <Icon size="36" src="new.svg" />
      </div>
      <span class="tag is-block">{{ $t("new_text") }}</span>
    </div>
    <div v-for="text in savedTexts" :key="text" class="is-pulled-left saved-text">
      <ContextMenu>
        <template #trigger>
          <Skeleton :data="text" />
        </template>
        <template #context>
          <a class="panel-block has-text-danger" @click="deleteTextPermanently(text)">
            <span class="panel-icon">
              <Icon src="remove.svg" />
            </span>
            <span>{{ $t("delete_permanently") }}</span>
          </a>
        </template>
      </ContextMenu>
    </div>
  </template>
  <template v-else>
    <div class="text-tool" style="width: 200px; z-index: 1005">
      <span class="tag muted is-block">{{ $t("font") }}</span>
      <Dropdown class="font-dropdown" v-model="options.fontFamily" :data="fontFamilies" @open="fontDropdownOpen">
        <template #option="{ label }">
          <span :style="{ 'font-family': label }">{{ label }}</span>
        </template>
      </Dropdown>
    </div>
    <div class="text-tool" style="z-index: 1004">
      <span class="tag muted is-block">Size (px)</span>
      <Field :modelValue="options.fontSize.slice(0, -2)" @update:modelValue="changeFontSize" type="number" />
    </div>
    <div class="text-tool" style="z-index: 1003">
      <span class="tag muted is-block">{{ $t("colour") }}</span>
      <ColorPicker v-model="options.color" />
    </div>
    <div class="text-tool" :class="{ active: options.fontWeight }" @click="toggleBold">
      <div class="icon is-large">
        <Icon size="36" src="bold.svg" />
      </div>
      <span class="tag is-block">{{ $t("bold") }}</span>
    </div>
    <div class="text-tool" :class="{ active: options.fontStyle }" @click="toggleItalic">
      <div class="icon is-large">
        <Icon size="36" src="italic.svg" />
      </div>
      <span class="tag is-block">{{ $t("italic") }}</span>
    </div>
    <div class="text-tool" :class="{ active: options.textDecoration }" @click="toggleUnderline">
      <div class="icon is-large">
        <Icon size="36" src="underline.svg" />
      </div>
      <span class="tag is-block">{{ $t("underline") }}</span>
    </div>
    <div class="text-tool has-tooltip-bottom" @click="saveText">
      <div class="icon is-large">
        <Icon size="40" src="check.svg" />
      </div>
      <span class="tag is-block">{{ $t("save") }}</span>
    </div>
    <div class="text-tool" @click="cancelWriting">
      <div class="icon is-large">
        <Icon size="32" src="cancel.svg" />
      </div>
      <span class="tag is-block">{{ $t("cancel") }}</span>
    </div>
  </template>
</template>

<script setup lang="ts">
import Dropdown from "components/form/Dropdown.vue";
import Field from "components/form/Field.vue";
import ColorPicker from "components/form/ColorPicker.vue";
import ContextMenu from "components/ContextMenu.vue";
import Skeleton from "../Skeleton.vue";
import Icon from "components/Icon.vue";
import { useTextStore } from "store/modules/text";
import { useStageStore } from "store";
import { computed, onUnmounted, ref } from "vue";
import { v4 as uuidv4 } from "uuid";

const textStore = useTextStore();
const stageStore = useStageStore();

const stageSize = computed(() => stageStore.stageSize);
const isWriting = computed(() => textStore.isWriting);
const options = computed(() => textStore.options);
const savedTexts = computed(() => textStore.texts);

const fontFamilies = [
  "Josefin Sans",
  "Arial",
  "Times New Roman",
  "Helvetica",
  "Times",
  "Courier New",
  "Verdana",
  "Courier",
  "Arial Narrow",
  "Candara",
  "Geneva",
  "Calibri",
  "Optima",
  "Cambria",
  "Garamond",
  "Perpetua",
  "Monaco",
  "Didot",
  "Brush Script MT",
  "Lucida Bright",
  "Copperplate",
  "Roboto",
  "Open Sans",
  "Lato",
  "Roboto Condensed",
  "Oswald",
  "Poppins",
  "Roboto Mono",
  "PT Sans",
  "Ubuntu",
  "Playfair Display",
  "PT Serif",
  "Fira Sans",
  "Bebas Neue",
  "Anton",
  "Lobster",
  "Varela Round",
  "Arvo",
  "Pacifico",
  "Asap",
  "Overpass",
  "Abril Fatface",
];

const el = ref();

const changeFontSize = (value: string) => {
  textStore.updateTextOptions({
    fontSize: value.replace(/^\D+/g, "") + "px"
  });
};

const createText = () => {
  textStore.updateIsWriting(true);
  stageStore.setActiveMovable(null);
  onClickWriting({
    clientX: (window?.innerWidth ?? 0) / 2 - 200,
    clientY: (window?.innerHeight ?? 0) / 2 - 50,
  } as MouseEvent);
};

const cancelWriting = () => {
  textStore.updateIsWriting(false);
};

const onClickWriting = (e: MouseEvent) => {
  const { width, height } = el.value.getBoundingClientRect() ?? {};
  const x = e.clientX - stageSize.value.left - width / 2;
  const y = e.clientY - stageSize.value.top - height / 2;
  textStore.updateTextOptions({
    left: x + "px",
    top: y + "px",
    x,
    y,
  });
  el.value.focus();
};

const saveText = async () => {
  const { width, height } = el.value.getBoundingClientRect() ?? {};
  textStore.updateIsWriting(false);
  const textId = uuidv4();
  textStore.addText({
    ...options.value,
    content: el.value.innerHTML,
    w: width + 10,
    h: height + 10,
    textId,
  });
};

const toggleBold = () => {
  const fontWeight = !options.value.fontWeight ? "bold" : undefined;
  textStore.updateTextOptions({ fontWeight });
};

const toggleItalic = () => {
  const fontStyle = !options.value.fontStyle ? "italic" : undefined;
  textStore.updateTextOptions({ fontStyle });
};

const toggleUnderline = () => {
  const textDecoration = !options.value.textDecoration ? "underline" : undefined;
  textStore.updateTextOptions({ textDecoration });
};

const fontDropdownOpen = (visible: boolean) => {
  const topbar = document.querySelector("#topbar");
  if (topbar) {
    (topbar as HTMLElement).style.overflow = visible ? "visible" : "auto";
  }
};

const deleteTextPermanently = (text: any) => {
  textStore.deleteText(text.textId);
  stageStore.objects
    .filter((o) => o.textId === text.textId)
    .forEach((o) => {
      stageStore.deleteObject(o);
    });
};

onUnmounted(() => {
  const topbar = document.querySelector("#topbar");
  if (topbar) {
    (topbar as HTMLElement).style.overflow = "auto";
  }
});
</script>

<style lang="scss">
.writing {
  position: fixed;
  z-index: 1000;
  background-color: rgba($color: white, $alpha: 0.8);

  >p {
    position: absolute;
  }
}

.text-tool {
  z-index: 1001;
  position: relative;
  float: left;
}

.saved-text {
  >div {
    width: 100%;
    overflow: hidden;

    p {
      font-size: 12px !important;
      transform: none !important;
      transform-origin: none !important;
      margin: 0px !important;
    }
  }
}
</style>
