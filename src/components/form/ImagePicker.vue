<template>
  <modal :styles="{ zIndex: `999 !important` }">
    <template #trigger>
      <Asset class="clickable" v-if="modelValue" :asset="{
        src: modelValue,
      }" />
      <button v-else class="button">{{ $t("choose_an_image") }}</button>
    </template>
    <template #header><span>{{
      $t("choose_an_existing_image_or_upload_new")
        }}</span></template>
    <template #content="{ closeModal }">
      <Loading v-if="loadingMedia" />
      <div v-else class="columns is-multiline">
        <div class="column is-12">
          <div class="columns">
            <a-space class="shadow rounded-xl px-4 py-2 bg-white flex justify-between">
              <a-space class="flex-wrap">
                <a-button type="primary" @click="visibleDropzone = true; onVisibleDropzone()">
                  <PlusOutlined /> {{ $t("new") }} {{ $t("media") }}
                </a-button>
                <a-input-search allowClear class="w-48" placeholder="Search media" v-model:value="formData.name" />
                <a-select allowClear showArrow :filterOption="handleFilterOwnerName" mode="tags"
                  style="min-width: 124px" placeholder="Owners" :loading="loading" v-model:value="formData.owners"
                  :options="result
                    ? result.users.map((e) => {
                      return {
                        value: e.username,
                        label: e.displayName || e.username,
                      }
                    })
                    : []
                    ">
                  <template #dropdownRender="{ menuNode: menu }">
                    <v-nodes :vnodes="menu" />
                    <a-divider style="margin: 4px 0" />
                    <div class="w-full cursor-pointer text-center" @mousedown.prevent
                      @click.stop.prevent="formData.owners = []">
                      <team-outlined />&nbsp;All players
                    </div>
                  </template>
                </a-select>
                <a-select allowClear showArrow filterOption mode="tags" style="min-width: 128px"
                  placeholder="Media types" :loading="loading" v-model:value="formData.types" :options="result
                    ? result.mediaTypes
                      .filter(
                        (e) =>
                          !['shape', 'media'].includes(e.name.toLowerCase()),
                      )
                      .map((e) => ({
                        value: e.name,
                        label: capitalize(e.name),
                      }))
                    : []
                    ">
                </a-select>
                <a-select allowClear showArrow :filterOption="handleFilterStageName" mode="tags"
                  style="min-width: 160px" placeholder="Stages assigned" :loading="loading"
                  v-model:value="formData.stages" :options="result
                    ? result.stages.edges.map((e) => ({
                      value: e.id,
                      label: e.name,
                    }))
                    : []
                    ">
                </a-select>
                <a-select allowClear showArrow mode="tags" style="min-width: 160px" placeholder="Tags"
                  :loading="loading" v-model:value="formData.tags" :options="result
                    ? result.tags.map((e) => ({
                      value: e.name,
                      label: e.name,
                    }))
                    : []
                    "></a-select>
                <a-range-picker :placeholder="['Created from', 'to date']" :presets="ranges"
                  v-model:value="formData.dates" :popupStyle="{ zIndex: 5000 }" />
                <a-button v-if="hasFilter" type="dashed" @click="clearFilters">
                  <ClearOutlined />Clear Filters
                </a-button>
              </a-space>
            </a-space>
          </div>
        </div>
        <StageMediaTable :data="availableImages" :loading="loadingMedia"
          @viewDetail="(item) => select(item, closeModal)" />
      </div>
    </template>
  </modal>
  <MediaForm />
</template>

<script>
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween'
import { isEmpty, assign, get } from 'lodash';
import { editingMediaVar } from "apollo";
import Modal from "components/Modal.vue";
import Loading from "components/Loading.vue";
import Asset from "components/Asset.vue";
import { computed, provide, reactive, onMounted, inject, watch } from "vue";
import { capitalize } from "utils/common";
import Dropdown from "./Dropdown.vue";
import { displayName } from "utils/common";
import { stageGraph } from "services/graphql";
import { useQuery } from "services/graphql/composable";
import MediaUpload from "./Media/MediaUpload.vue";
import MediaForm from 'components/media/MediaForm/index.vue';
import VNodes from './VNodes';
import StageMediaTable from './StageMediaTable.vue';

dayjs.extend(isBetween);

export default {
  props: ["modelValue"],
  emits: ["update:modelValue"],
  components: { Modal, Loading, Asset, Dropdown, MediaUpload, VNodes, MediaForm, StageMediaTable },
  setup: (props, { emit }) => {
    const {
      loading: loadingMedia,
      nodes: mediaList,
      refresh,
    } = useQuery(stageGraph.mediaList);
    const { data, loading } = useQuery(stageGraph.getSearchOption);
    const type_dis = ["avatar", "prop", "backdrop", "shape", "curtain"];
    provide("refresh", refresh);
    provide("whoami", null);
    const visibleDropzone = inject("visibleDropzone");
    const result = computed(() => data?.value);


    const onVisibleDropzone = () => {
      editingMediaVar(undefined);
    }

    onMounted(() => {
      refresh();
    });

    const select = (item, closeModal) => {
      emit("update:modelValue", item.src);
      closeModal();
    };

    const filter = reactive({
      name: null,
      mediaType: null,
      owner: null,
      stage: null,
    });

    const formData = reactive({
      name: null,
      owners: [],
      types: [],
      stages: [],
      tags: [],
      dates: [],
    })

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

    const hasFilter = computed(
      () =>
        !isEmpty(formData)
    );

    const { nodes: typesData } = useQuery(stageGraph.mediaTypeList);
    const types = computed(() => {
      const list = [];
      list.push({ id: null, name: "All Types" });
      typesData.value
        .filter((m) => type_dis.includes(m.name))
        .forEach((type) => list.push(type));
      return list;
    });

    const users = computed(() => {
      let list = [];
      list.push({ id: null, displayName: "All Users" });
      if (mediaList.value) {
        mediaList.value.forEach(({ owner }) => {
          if (!list.some((user) => user.username === owner.username)) {
            list.push(owner);
          }
        });
      }
      return list;
    });

    const { nodes: stagesData } = useQuery(stageGraph.stageList);
    const stages = computed(() => {
      let list = [];
      list.push({ id: null, name: "All Stages" });
      if (stagesData.value) {
        stagesData.value.forEach((stage) => list.push(stage));
      }
      return list;
    });

    const availableImages = computed(() => {
      let medias = mediaList.value;

      if (medias?.length) {
        medias = medias
          .filter(
            (media) =>
              !["audio", "video"].includes(get(media, "assetType.name"))
          )
          .filter((media) => ![0, 3, 4].includes(media.privilege));
      }

      if (formData.name) {
        medias = medias.filter((media) =>
          media.name.toLowerCase().includes(formData.name.toLowerCase()),
        );
      }
      if (formData.owners.length) {
        medias = medias.filter((media) => formData.owners.includes(media.owner.displayName || media.owner.username))
      }
      if (formData.types.length) {
        medias = medias.filter((media) => formData.types.includes(get(media, 'assetType.id', get(media, 'assetType'))))
      }
      if (formData.stages.length) {
        medias = medias.filter((media) => formData.stages.some((stage) => media.stages.some(({ id }) => id === stage)))
      }
      if (formData.dates.length) {
        medias = medias.filter((media) => dayjs(media.createdOn).isBetween(formData.dates[0], formData.dates[1]))
      }
      return medias;
    });


    const handleFilterOwnerName = (keyword, option) => {
      const s = keyword.toLowerCase();
      return (
        option.value.toLowerCase().includes(s) ||
        option.label.toLowerCase().includes(s)
      );
    };
    const handleFilterStageName = (keyword, option) => {
      return option.label.toLowerCase().includes(keyword.toLowerCase());
    };

    const clearFilters = () => {
      assign(formData, {
        name: null,
        owners: [],
        types: [],
        stages: [],
        tags: [],
        dates: [],
      })
    };

    return {
      loading,
      loadingMedia,
      dayjs,
      ranges,
      availableImages,
      select,
      filter,
      types,
      users,
      displayName,
      hasFilter,
      mediaList,
      stages,
      formData,
      result,
      capitalize,
      visibleDropzone,
      onVisibleDropzone,
      clearFilters,
      handleFilterOwnerName,
      handleFilterStageName,
    };
  },
};
</script>

<style>
.modal-card-title {
  margin-bottom: 0px;
}

.modal-card {
  border-top: none;
}

.dropdown .button {
  width: 95%;
}

.dropdown-content {
  margin-left: 1%;
}

.gallery {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-gap: 1.5rem;
}

.gallery .card-image {
  display: flex;
  justify-content: center;
}

.gallery img {
  height: 10vw;
  width: auto;
}

.uploadbtn {
  flex-grow: 0;
}
</style>
