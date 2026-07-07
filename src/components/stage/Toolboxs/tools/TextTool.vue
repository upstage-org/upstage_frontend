<script>
import Dropdown from "components/form/Dropdown.vue";
import Field from "components/form/Field.vue";
import ColorPicker from "components/form/ColorPicker.vue";
import ContextMenu from "components/ContextMenu.vue";
import Skeleton from "../Skeleton.vue";
import Icon from "components/Icon.vue";
import { useStageStore } from "@stores/pinia/stage";
import { computed, onUnmounted, ref } from "vue";
import { v4 as uuidv4 } from "uuid";

export default {
  components: { Dropdown, Field, ColorPicker, Skeleton, Icon, ContextMenu },
  setup: () => {
    const stageStore = useStageStore();
    const stageSize = computed(() => stageStore.stageSize);
    const isWriting = computed(() => stageStore.preferences.isWriting);
    const options = stageStore.preferences.text;
    // Web-safe system fonts plus the open-source webfonts loaded via the
    // Google Fonts @imports in styles/custom.less (keep both in sync).
    const fontFamilies = [
      "Josefin Sans",
      // Web-safe / system fonts
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
      // Opensource fonts (custom.less batch 1)
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
      // Opensource fonts (custom.less batch 2: sans / serif / mono)
      "Amatic SC",
      "Barlow",
      "Bitter",
      "Cabin",
      "Caveat",
      "Cinzel",
      "Comfortaa",
      "Cormorant Garamond",
      "Crimson Text",
      "Dancing Script",
      "EB Garamond",
      "Inconsolata",
      "Inter",
      "Kalam",
      "Karla",
      "Libre Baskerville",
      "Merriweather",
      "Montserrat",
      "Nunito",
      "Orbitron",
      "Quicksand",
      "Raleway",
      "Source Code Pro",
      "Work Sans",
      "Zilla Slab",
      // Opensource fonts (custom.less batch 3: display / handwriting)
      "Alfa Slab One",
      "Architects Daughter",
      "Audiowide",
      "Bangers",
      "Chewy",
      "Courgette",
      "Creepster",
      "Fredericka the Great",
      "Great Vibes",
      "Homemade Apple",
      "Indie Flower",
      "Luckiest Guy",
      "Monoton",
      "Patrick Hand",
      "Permanent Marker",
      "Press Start 2P",
      "Righteous",
      "Rock Salt",
      "Satisfy",
      "Shadows Into Light",
      "Special Elite",
      "VT323",
    ].sort((a, b) => a.localeCompare(b));
    const changeFontSize = (value) => {
      options.fontSize = value.replace(/^\D+/g, "") + "px";
    };

    const createText = () => {
      stageStore.UPDATE_IS_WRITING(true);
      stageStore.SET_ACTIVE_MOVABLE(null);
      onClickWriting({
        clientX: window.innerWidth / 2 - 200,
        clientY: window.innerHeight / 2 - 50,
      });
    };

    const cancelWriting = () => {
      stageStore.UPDATE_IS_WRITING(false);
    };

    const el = ref();
    const onClickWriting = (e) => {
      const { width, height } = el.value.getBoundingClientRect() ?? {};
      const x = e.clientX - stageSize.value.left - width / 2;
      const y = e.clientY - stageSize.value.top - height / 2;
      stageStore.UPDATE_TEXT_OPTIONS({
        left: x + "px",
        top: y + "px",
        x,
        y,
      });
      el.value.focus();
    };

    const saveText = async () => {
      const { width, height } = el.value.getBoundingClientRect() ?? {};
      stageStore.UPDATE_IS_WRITING(false);
      const textId = uuidv4();
      stageStore.addText({
        ...options,
        content: el.value.innerHTML,
        w: width + 10,
        h: height + 10,
        textId,
      });
    };

    const toggleBold = () => {
      let fontWeight;
      if (!options.fontWeight) {
        fontWeight = "bold";
      }
      stageStore.UPDATE_TEXT_OPTIONS({ fontWeight });
    };

    const toggleItalic = () => {
      let fontStyle;
      if (!options.fontStyle) {
        fontStyle = "italic";
      }
      stageStore.UPDATE_TEXT_OPTIONS({ fontStyle });
    };

    const toggleUnderline = () => {
      let textDecoration;
      if (!options.textDecoration) {
        textDecoration = "underline";
      }
      stageStore.UPDATE_TEXT_OPTIONS({ textDecoration });
    };

    const savedTexts = computed(() => stageStore.board.texts);
    const fontDropdownOpen = (visible) => {
      const topbar = document.querySelector("#topbar");
      if (topbar) {
        topbar.style.overflow = visible ? "visible" : "auto";
      }
    };

    onUnmounted(() => {
      const topbar = document.querySelector("#topbar");
      if (topbar) {
        topbar.style.overflow = "auto";
      }
    });

    const deleteTextPermanently = (text) => {
      stageStore.POP_TEXT(text.textId);
      stageStore.objects
        .filter((o) => o.textId === text.textId)
        .forEach((o) => {
          stageStore.deleteObject(o);
        });
    };

    // Removes every placed text object from the stage; the saved texts stay
    // in this strip for re-placing (unlike delete permanently).
    const clearAll = () => stageStore.clearStageObjectsOfKind("text");
    onUnmounted(() => {
      const topbar = document.querySelector("#topbar");
      if (topbar) topbar.style.overflow = "auto";
    });

    return {
      stageSize,
      options,
      fontFamilies,
      createText,
      isWriting,
      cancelWriting,
      onClickWriting,
      saveText,
      el,
      toggleBold,
      toggleItalic,
      toggleUnderline,
      changeFontSize,
      savedTexts,
      fontDropdownOpen,
      deleteTextPermanently,
      clearAll,
    };
  },
};
</script>

<template>
  <section
    v-show="isWriting"
    class="writing"
    :style="{
      width: stageSize.width + 'px',
      height: stageSize.height + 'px',
      top: stageSize.top + 'px',
      left: stageSize.left + 'px',
    }"
    @click="onClickWriting"
  >
    <p ref="el" :style="options" contenteditable="true">
      Write or paste
      <br />your text here
    </p>
  </section>
  <template v-if="!isWriting">
    <div @click="clearAll">
      <div class="icon is-large">
        <Icon size="36" src="clear.svg" />
      </div>
      <span class="tag is-light is-block">{{ $t("clear") }}</span>
    </div>
    <div class="text-tool" @click="createText">
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
      <Dropdown
        v-model="options.fontFamily"
        class="font-dropdown"
        :data="fontFamilies"
        @open="fontDropdownOpen"
      >
        <template #option="{ label }">
          <span :style="{ 'font-family': label }">{{ label }}</span>
        </template>
      </Dropdown>
    </div>
    <div class="text-tool" style="z-index: 1004">
      <span class="tag muted is-block">Size (px)</span>
      <Field
        :model-value="options.fontSize.slice(0, -2)"
        type="number"
        @update:model-value="changeFontSize"
      />
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

<style lang="scss">
.writing {
  position: fixed;
  z-index: 1000;
  background-color: rgba($color: white, $alpha: 0.8);

  > p {
    position: absolute;
  }
}

.text-tool {
  z-index: 1001;
  position: relative;
  float: left;
}

.saved-text {
  > div {
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
