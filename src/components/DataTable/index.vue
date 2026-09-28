<script setup lang="ts">
import { useQuery } from "services/graphql/composable";
import Loading from "components/Loading.vue";
import { computed, onMounted, ref } from "vue";
import type { Ref } from "vue";
import dayjs from "@utils/dayjs";
import Pagination from "./Pagination.vue";
import { CaretUpOutlined, CaretDownOutlined } from "@ant-design/icons-vue";

const props = withDefaults(
  defineProps<{
    query?: (...args: any[]) => any;
    headers?: any[];
    numbered?: boolean;
    data?: any[];
    wrapper?: boolean;
  }>(),
  {
    query: undefined,
    headers: () => [],
    numbered: true,
    data: undefined,
    wrapper: true,
  },
);

// Decided once, at setup: a table that is given `data` never queries.
const source: {
  nodes: Ref<any>;
  totalCount: Ref<number>;
  loading?: Ref<boolean>;
  refresh?: (...args: any[]) => any;
} = props.data
  ? {
      nodes: computed(() => props.data),
      totalCount: computed(() => props.data!.length),
    }
  : useQuery(props.query as any);
const { nodes, totalCount, loading, refresh } = source;

const current = ref(1);
const limit = ref(10);
const sortBy = ref<any>(null);
const sortOrder = ref(true);
const now = new Date();

const offset = computed(() => limit.value * (current.value - 1));
const rows = computed(() => {
  let rows = [...nodes.value];
  if (sortBy.value) {
    const { sortable, type, render, key } = sortBy.value;
    rows = rows.sort((a: any, b: any): any => {
      if (typeof sortable === "function") {
        return sortable(a, b);
      }
      if (type === "date") {
        return dayjs(a[key]).diff(b[key]);
      }
      if (render) {
        return render(a).localeCompare(render(b));
      }
      if (key) {
        return a[key]?.localeCompare(b[key]);
      }
    });
  }
  if (!sortOrder.value) {
    rows.reverse();
  }
  const start = offset.value;
  const end = start + limit.value;
  let endR: number;
  if (rows.length < end) {
    endR = rows.length;
  } else {
    endR = end;
  }
  rows?.forEach((row, index) => {
    if (index == endR - 1 || index == endR - 2) {
      row.lastItem = true;
    } else {
      row.lastItem = false;
    }
  });
  return rows.slice(start, end);
});

onMounted(() => {
  const header = props.headers.find((h) => h.defaultSortOrder !== undefined);
  if (header) {
    sortBy.value = header;
    sortOrder.value = header.defaultSortOrder;
  }
});

const fromNow = (date: any) => dayjs(date).fromNow();

const sort = (header: any) => {
  if (header.sortable) {
    if (sortBy.value?.title === header.title) {
      sortOrder.value = !sortOrder.value;
    }
    sortBy.value = header;
  }
};

const handleFormatDate = (date: any) => {
  if (date == null) {
    return null;
  }

  if (dayjs(now).diff(date, "weeks") > 1) {
    return dayjs(date).format("DD/MM/yyyy");
  }

  return fromNow(date);
};
</script>

<template>
  <Loading v-if="loading" />
  <div v-else :class="{ 'table-wrapper': wrapper }">
    <table class="table">
      <thead>
        <tr>
          <th v-if="numbered" align="right">#</th>
          <th
            v-for="header in headers"
            :key="header"
            align="left"
            :style="{ 'text-align': header.align }"
            class="clickable"
            @click="sort(header)"
          >
            <a-tooltip :title="header.description">
              <abbr class="has-tooltip-bottom">
                {{ header.title }}
              </abbr>
            </a-tooltip>
            &nbsp;
            <template v-if="header.sortable">
              <span class="upstage-dt-sorter" aria-hidden="true">
                <CaretUpOutlined
                  class="upstage-dt-sorter-icon"
                  :class="{
                    'upstage-dt-sorter-icon--active': sortBy?.title === header.title && sortOrder,
                  }"
                />
                <CaretDownOutlined
                  class="upstage-dt-sorter-icon"
                  :class="{
                    'upstage-dt-sorter-icon--active': sortBy?.title === header.title && !sortOrder,
                  }"
                />
              </span>
            </template>
          </th>
        </tr>
      </thead>
      <tfoot v-if="!nodes.length">
        <tr>
          <td
            class="has-text-centered has-text-dark"
            :colspan="headers.length + (numbered ? 1 : 0)"
          >
            <i class="fas fa-frown fa-4x"></i>
            <div>No replay recordings have been saved for this stage yet.</div>
          </td>
        </tr>
      </tfoot>
      <tbody>
        <transition-group :css="false">
          <tr v-for="(item, index) in rows" :key="item">
            <td v-if="numbered" align="right">{{ offset + index + 1 }}</td>
            <td
              v-for="header in headers"
              :key="header"
              :style="{ 'text-align': header.align }"
              :class="header.slot"
            >
              <slot
                :name="header.slot"
                :item="item"
                :header="header"
                :refresh="refresh ?? (() => {})"
              >
                <template v-if="header.render">
                  {{ header.render(item) }}
                </template>
                <template v-else-if="header.type === 'date'">
                  <span :title="dayjs(item[header.key]).toString()">
                    {{ handleFormatDate(item[header.key]) }}
                  </span>
                </template>
                <template v-else>{{ item[header.key] }}</template>
              </slot>
            </td>
          </tr>
        </transition-group>
      </tbody>
    </table>
    <Pagination v-model="current" v-model:limit="limit" :total="totalCount" />
  </div>
</template>

<style scoped>
.upstage-dt-sorter {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  margin-left: 4px;
  vertical-align: middle;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.25);
}
.upstage-dt-sorter-icon {
  line-height: 1;
}
.upstage-dt-sorter-icon:first-of-type {
  margin-bottom: -0.3em;
}
.upstage-dt-sorter-icon--active {
  color: #007011;
}

.table-wrapper {
  overflow-x: auto;
  overflow-y: hidden;
  padding-right: 24px;
}

table {
  width: 100%;
}
</style>
