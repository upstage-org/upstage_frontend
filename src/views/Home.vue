<template>
  <section id="welcome" class="hero is-fullheight foyer-background">
    <div class="hero-body">
      <div class="container">
        <div class="describe">
          <h1 class="title" v-html="foyer.title?.value" />
          <div v-if="foyer.description" class="subtitle" v-html="foyer.description.value" />
        </div>
        <Loading v-if="loading" />
        <div v-else class="stages my-4 pt-6">
          <masonry-wall :items="visibleStages" :ssr-columns="1" :column-width="300" :gap="32">
            <template #default="{ item }">
              <Entry :stage="item" :fallback-cover="'greencurtain.jpg'" />
            </template>
          </masonry-wall>
        </div>
      </div>
    </div>
  </section>
</template>

<script>
import { computed } from "vue";
import { useStore } from "vuex";
import Loading from "components/Loading.vue";
import { absolutePath } from "utils/common";
import Entry from "components/stage/Entry.vue";
import MasonryWall from "@yeger/vue-masonry-wall";
import { stageGraph } from "services/graphql";
import { useQuery } from "@vue/apollo-composable";
import gql from "graphql-tag";

export default {
  name: "Home",
  components: { Loading, Entry, MasonryWall },
  setup: () => {
    const store = useStore();
    const { result, loading } = useQuery(gql`
      query ListFoyerStage {
        foyerStageList {
          id
          name
          owner {
            displayName
            username
          }
          fileLocation
          cover
        }
      }
    `, null);
    const foyer = computed(() => store.getters["config/foyer"]);
    const visibleStages = computed(() => result?.value?.foyerStageList || []);
    return {
      visibleStages,
      loading,
      absolutePath,
      foyer,
    };
  },
};
</script>

<style scoped lang="scss">
#welcome {
  text-align: center;

  .hero-body {
    position: relative;
  }

  .title {
    color: black;
    text-shadow: -3px 0 #007011;
    font-size: 50px !important;

    &:after {
      content: "";
      pointer-events: none;
      position: absolute;
      width: 100%;
      height: 100%;
      background-image: url("/img/foyer-background.png");
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      animation: fadeIn 1s;
      opacity: 0.5;
      max-height: 350px;
    }
  }

  .subtitle {
    padding: 0.5em;
    margin: auto;
    white-space: pre-wrap;

    :deep(h1) {
      font-size: 1.5rem !important;
      margin: 0.5rem 0;
      font-weight: 600;
    }

    :deep(p) {
      font-size: 1rem !important;
      margin: 0.5rem 0;
    }

    :deep(span) {
      font-size: inherit !important;
    }

    :deep(a) {
      color: #007011 !important;
      font-size: inherit !important;
      text-decoration: none;

      &:hover {
        color: #007011 !important;
        text-decoration: underline;
      }
    }

    :deep(*[style*="font-size"]) {
      font-size: inherit !important;
    }

    >:after {
      content: "";
      pointer-events: none;
      position: absolute;
      width: 100%;
      height: 100%;
      background-image: url("/img/foyer-background.png");
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      animation: fadeIn 1s;
      opacity: 0.5;
      max-height: 250px;
    }

    :deep(span strong) {
      font-size: inherit !important;
    }
  }

  .subtitle strong {
    color: initial !important;
    font-weight: 600;
  }

  .filters {
    display: flex;
    padding: 0.5em;

    .filter {
      justify-content: center;
      padding-right: 0.5em;
    }
  }

  .describe {
    position: relative;
  }

  .brushstroke {
    position: absolute;
    top: 0px;
    right: 0px;
    opacity: 0.5;
    max-width: 15vw;
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 0.5;
  }
}
</style>