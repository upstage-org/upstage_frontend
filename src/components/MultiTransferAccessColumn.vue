<script>
import { reactive } from "vue";
import { watch } from "vue";
import { includesIgnoreCase } from "utils/common";
import { RightOutlined, LeftOutlined } from "@ant-design/icons-vue";
export default {
  components: { RightOutlined, LeftOutlined },
  props: {
    columns: Array,
    modelValue: Array,
    data: { type: Array, default: () => [] },
    owner: Object,
    renderLabel: {
      type: Function,
      default: (item) => item,
    },
    renderValue: {
      type: Function,
      default: (item) => item,
    },
    renderKeywords: Function,
  },
  emits: ["update:modelValue"],
  setup: (props, { emit }) => {
    const positions = reactive([]);
    const searchs = reactive([]);

    const matchSearch = (item, column) => {
      if (!searchs[column]) {
        return true;
      }
      const transform = props.renderKeywords ?? props.renderLabel;
      return includesIgnoreCase(transform(props.data[item]), searchs[column]);
    };

    const shouldVisible = (item, column) => {
      return (positions[item] ?? 0) === column && matchSearch(item, column);
    };

    const moveRight = (item) => {
      let currentPosition = positions[item] ?? 0;
      if (currentPosition < props.columns.length - 1) {
        positions[item] = currentPosition + 1;
      }
    };

    const moveLeft = (item) => {
      const currentPosition = positions[item] ?? 0;
      if (currentPosition > 0) {
        positions[item] = currentPosition - 1;
      }
    };

    /** Last column cannot move right; primary click moves one step left like other columns advance right. */
    const onRowClick = (itemIndex, columnIndex) => {
      if (columnIndex === props.columns.length - 1) {
        moveLeft(itemIndex);
      } else {
        moveRight(itemIndex);
      }
    };

    /** Right-click moves one column left; not defined in the audience-only column. */
    const onRowContextMenu = (e, itemIndex, columnIndex) => {
      if (columnIndex <= 0) return;
      e.preventDefault();
      moveLeft(itemIndex);
    };

    watch(positions, () => {
      let res = [];
      for (let i = 1; i < props.columns.length; i++) {
        if (!res[i - 1]) {
          res[i - 1] = [];
        }
        for (let j = 0; j < props.data.length; j++) {
          if (positions[j] === i) {
            res[i - 1].push(props.renderValue(props.data[j]));
          }
        }
      }
      emit("update:modelValue", res);
    });

    watch(
      [() => props.modelValue, () => props.data],
      ([val]) => {
        if (props.data) {
          for (let i = 0; i < val.length; i++) {
            for (let j = 0; j < (val[i] ?? []).length; j++) {
              positions[props.data.findIndex((item) => props.renderValue(item) === val[i][j])] =
                i + 1;
            }
          }
        }
      },
      { immediate: true },
    );

    const count = (i) =>
      props.data ? props.data.filter((item, p) => (positions[p] ?? 0) === i).length : 0;

    const moveAll = (from, to) => {
      for (let i = 0; i < props.data.length; i++) {
        if ((positions[i] ?? 0) === from && shouldVisible(i, from)) {
          positions[i] = to;
        }
      }
    };

    return { shouldVisible, moveRight, moveLeft, onRowClick, onRowContextMenu, count, searchs, moveAll };
  },
};
</script>

<template>
  <div class="columns">
    <template v-for="(column, i) in columns" :key="column">
      <div class="column">
        <article class="panel is-light">
          <p class="panel-heading">
            {{ column }}
            <span class="tag is-primary">
              {{ i == columns.length - 1 ? count(i) + 1 : count(i) }}
            </span>
          </p>
          <div class="panel-heading pt-0">
            <p class="control has-icons-left">
              <input
                v-model="searchs[i]"
                class="input is-primary"
                type="text"
                placeholder="Search"
              />
              <span class="icon is-left">
                <i class="fas fa-search" aria-hidden="true"></i>
              </span>
            </p>
          </div>
          <div class="panel-body">
            <a v-if="i == columns.length - 1" class="panel-block owner">
              {{ renderLabel(owner) }}
              <p class="panel-tag">owner</p>
            </a>
            <template v-for="(item, j) in data" :key="renderValue(item)">
              <a
                v-if="shouldVisible(j, i)"
                class="panel-block"
                @click="onRowClick(j, i)"
                @contextmenu="onRowContextMenu($event, j, i)"
              >
                {{ renderLabel(item) }}
              </a>
            </template>
          </div>
        </article>
      </div>
      <div
        v-if="i < columns.length - 1"
        class="column is-narrow px-0 is-flex is-align-self-center"
      >
        <div class="upstage-multi-transfer-arrows">
          <button
            type="button"
            class="upstage-multi-transfer-btn"
            title="Move all matching right"
            @click="moveAll(i, i + 1)"
          >
            <RightOutlined />
          </button>
          <button
            type="button"
            class="upstage-multi-transfer-btn"
            title="Move all matching left"
            @click="moveAll(i + 1, i)"
          >
            <LeftOutlined />
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
article.panel {
  width: 100%;
}
.panel-heading {
  font-size: unset;
}
.panel-body {
  max-height: 50vh;
  overflow-y: auto !important;
}
.panel-block.owner {
  position: relative;
  background-color: #00000015;
}
.panel-tag {
  position: absolute;
  background-color: #007011;
  font-size: 0.8rem;
  color: #fff;
  padding: 0 5px;
  right: 10px;
}
</style>
