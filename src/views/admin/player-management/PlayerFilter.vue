<script lang="ts">
import { ref, watch, computed, onMounted } from "vue";
import { useQuery } from "@vue/apollo-composable";
import { useDebounceFn } from "@vueuse/core";
import gql from "graphql-tag";
import { StudioGraph } from "models/studio";
import { inquiryVar } from "apollo";
import moment, { Moment } from "moment";
import { getSharedAuth } from "utils/common";
import { h } from "vue";
import { Button, InputSearch, RangePicker, Space } from "ant-design-vue";
import Header from "components/Header.vue";
import { PlusOutlined } from "@ant-design/icons-vue";
import { useI18n } from "vue-i18n";
import BatchPlayerCreation from "views/admin/batch-player-creation/index.vue";
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

export default {
  setup() {
    // const { result, loading } = useQuery<StudioGraph>(gql`
    //   query AdminPlayerFilter {
    //     adminPlayers {
    //       edges {
    //         id
    //         username
    //       }
    //     }
    //   }
    // `);

    const sharedAuth = getSharedAuth();

    const name = ref("");
    const dates = ref<[Dayjs, Dayjs] | undefined>();

    const ranges = [
      {
        label: 'Today',
        value: [dayjs(), dayjs()],
      },
      {
        label: 'Yesterday',
        value: [dayjs().add(-1, 'd'), dayjs().add(-1, 'd')],
      },
      {
        label: 'Last 7 days',
        value: [dayjs().add(-7, 'd'), dayjs()],
      },
      {
        label: 'Last month',
        value: [dayjs().add(-1, 'month'), dayjs()],
      },
      {
        label: 'This year',
        value: [dayjs().startOf("year"), dayjs()],
      }
    ];

    const updateInquiry = (vars: any) =>
      inquiryVar({
        ...inquiryVar(),
        ...vars,
      });

    const watchInquiryVar = (vars: any) => {
      inquiryVar.onNextChange(watchInquiryVar);
    };
    inquiryVar.onNextChange(watchInquiryVar);

    watch(
      name,
      useDebounceFn(() => {
        updateInquiry({ usernameLike: name.value });
      }, 500),
    );
    onMounted(() => {
      updateInquiry({
        createdBetween: undefined
      });
    });
    watch(dates, (_dates: any) => {
      updateInquiry({
        createdBetween: _dates
          ? [
            _dates[0]?.format("YYYY-MM-DD"),
            _dates[1]?.format("YYYY-MM-DD"),
          ]
          : undefined,
      });
    });
    const clearFilters = () => {
      name.value = "";
      dates.value = undefined;
    };

    const hasFilter = computed(() => name.value || dates.value);
    const { t } = useI18n();
    const drawerVisible = ref(false);

    return () => [
      h(BatchPlayerCreation, {
        visible: drawerVisible.value,
        onClose: () => {
          drawerVisible.value = false;
        },
      }),
      h(Header, {}, () => [
        h(
          Space,
          {
            class: "flex-wrap",
          },
          [
            h(
              Button,
              {
                icon: h(PlusOutlined),
                type: "primary",
                onClick: () => {
                  drawerVisible.value = true;
                },
              },
              [t("new_object", [t("player", 2)])],
            ),
            h(InputSearch, {
              allowClear: true,
              class: "w-48",
              placeholder: "Player name",
              value: name.value,
              "onUpdate:value": (value: string) => {
                name.value = value;
              },
            }),
            h(RangePicker as any, {
              placeholder: ["Created from", "to date"],
              value: dates.value,
              "onUpdate:value": (value: [Dayjs, Dayjs]) => {
                dates.value = value;
              },
              presets: ranges
            }),
            hasFilter.value &&
            h(
              Button,
              {
                type: "dashed",
                onClick: clearFilters,
              },
              [
                h("a-icon", {
                  type: "close-circle",
                }),
                "Clear Filters",
              ],
            ),
          ],
        ),
      ]),
    ];
  },
};
</script>
