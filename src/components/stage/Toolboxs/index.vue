<template>
  <TopBar :tool="toolboxStore.activeTool" />
  <nav id="toolbox" class="panel">
    <div class="panel-body">
      <PanelItem name="Audio" icon="audio.svg" />
      <hr />
      <PanelItem name="Backdrops" icon="backdrop.svg" />
      <PanelItem name="Avatars" icon="avatar.svg" />
      <PanelItem name="Props" icon="prop.svg" />
      <PanelItem name="Streams" label="Video" icon="stream.svg" />
      <PanelItem name="Meeting" label="Streams" icon="meeting.svg" />
      <PanelItem name="Whiteboard" icon="whiteboard.svg" label="Live drawing" />
      <PanelItem name="Draw" icon="object-drawing.svg" label="Object drawing" />
      <PanelItem name="Text" icon="text.svg" />
      <hr />
      <PanelItem name="Depth" icon="depth.svg" />
      <PanelItem name="Curtain" icon="curtain.svg" />
      <PanelItem name="Scenes" icon="animation-slider.svg" />
      <hr />
      <PanelItem name="Settings" icon="configurations.svg" />
      <PlayerChatTool />
    </div>
  </nav>
</template>

<script setup lang="ts">
import { provide } from "vue";
import TopBar from "./TopBar.vue";
import PanelItem from "./PanelItem.vue";
import PlayerChatTool from "./PlayerChatTool.vue";
import { useToolboxStore } from "store/modules/toolbox";

const toolboxStore = useToolboxStore();

provide("tool", toolboxStore.activeTool);
provide("changeTool", toolboxStore.changeTool);
</script>

<style lang="scss">
#toolbox {
  position: fixed;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  background-color: white;
  opacity: 0.9;
  transition: transform 0.5s;
  z-index: 6;

  hr {
    margin: 0;
  }

  @media only screen and (orientation: portrait) {
    top: 50px !important;
    transform: none !important;
  }

  .panel-icon {
    margin: auto;

    img {
      filter: grayscale(100%);
    }
  }

  .panel-block.is-active,
  .panel-block:hover {
    border: none;

    .panel-icon {
      img {
        filter: none;
      }

      transform: scale(1.5);
    }
  }
}
</style>
