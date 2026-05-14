<script>
import { useQuery } from "services/graphql/composable";
import Loading from "components/Loading.vue";
import { computed } from "vue";
import dayjs from "@utils/dayjs";
import Pagination from "./Pagination.vue";
import { CaretUpOutlined, CaretDownOutlined } from "@ant-design/icons-vue";

export default {
  components: { Loading, Pagination, CaretUpOutlined, CaretDownOutlined },
  props: {
    query: {
      type: Function,
    },
    headers: {
      type: Array,
      default: () => [],
    },
    numbered: {
      type: Boolean,
      default: true,
    },
    data: {
      type: Array,
    },
    wrapper: {
      type: Boolean,
      default: true,
    },
  },
  setup: (props) => {
    if (props.data) {
      return {
        nodes: computed(() => props.data),
        totalCount: computed(() => props.data.length),
      };
    }
    const { nodes, loading, totalCount, refresh } = useQuery(props.query);

    return { loading, nodes, totalCount, refresh };
  },
  data: function () {
    return {
      current: 1,
      limit: 10,
      sortBy: null,
      sortOrder: true,
      now: new Date(),
    };
  },
  computed: {
    offset() {
      return this.limit * (this.current - 1);
    },
    rows() {
      let rows = [...this.nodes];
      if (this.sortBy) {
        const { sortable, type, render, key } = this.sortBy;
        rows = rows.sort((a, b) => {
          if (typeof sortable === "function") {
            return sortable(a, b);
          }
          if (type === "date") {
            dayjs(a[key]).diff(b[key]);
          }
          if (render) {
            return render(a).localeCompare(render(b));
          }
          if (key) {
            return a[key]?.localeCompare(b[key]);
          }
        });
      }
      if (!this.sortOrder) {
        rows.reverse();
      }
      const start = this.offset;
      const end = start + this.limit;
      let endR;
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
    },
  },
  mounted() {
    const header = this.headers.find((h) => h.defaultSortOrder !== undefined);
    if (header) {
      this.sortBy = header;
      this.sortOrder = header.defaultSortOrder;
    }
  },
  methods: {
    dayjs,
    fromNow(date) {
      return dayjs(date).fromNow();
    },
    sort(header) {
      if (header.sortable) {
        if (this.sortBy?.title === header.title) {
          this.sortOrder = !this.sortOrder;
        }
        this.sortBy = header;
      }
    },

    handleFormatDate(date) {
      if (date == null) {
        return null;
      }

      if (dayjs(this.now).diff(date, "weeks") > 1) {
        return dayjs(date).format("DD/MM/yyyy");
      }

      return this.fromNow(date);
    },
  },
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
                    'upstage-dt-sorter-icon--active':
                      sortBy?.title === header.title && sortOrder,
                  }"
                />
                <CaretDownOutlined
                  class="upstage-dt-sorter-icon"
                  :class="{
                    'upstage-dt-sorter-icon--active':
                      sortBy?.title === header.title && !sortOrder,
                  }"
                />
              </span>
            </template>
          </th>
        </tr>
      </thead>
      <tfoot v-if="!nodes.length">
        <tr>
          <td class="has-text-centered has-text-dark" :colspan="headers.length + numbered">
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
