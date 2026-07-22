<script lang="ts">
import { computed, onMounted, ref } from "vue";
import { Spin, Tag } from "ant-design-vue";
import { stageGraph } from "services/graphql";

interface AccessStage {
  id: string;
  name: string;
  fileLocation: string;
  owner?: { id: string | number } | null;
  playerAccess?: string | null;
}

type Role = "owner" | "editor" | "player";

// Single-word labels keep the tags narrow so long stage names get the
// space; ranks put the strongest access first in the list.
const ROLES: Record<Role, { label: string; color: string; rank: number }> = {
  owner: { label: "Owner", color: "gold", rank: 0 },
  editor: { label: "Editor", color: "green", rank: 1 },
  player: { label: "Player", color: "blue", rank: 2 },
};

export default {
  components: { Spin, Tag },
  props: {
    player: {
      type: Object,
      required: true,
    },
  },
  setup(props) {
    const loading = ref(true);
    const error = ref("");
    const stages = ref<AccessStage[]>([]);

    onMounted(async () => {
      try {
        const response = (await stageGraph.stageAccessOverview()) as {
          stages?: { edges?: AccessStage[] };
        };
        stages.value = response.stages?.edges ?? [];
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
      } finally {
        loading.value = false;
      }
    });

    // Mirrors resolve_permission on the backend: ownership wins, then the
    // playerAccess attribute, which holds [[player ids], [editor ids]].
    // Older saves stored the ids as numbers, newer ones as strings — the
    // dev DB has both — so compare everything as strings.
    const roleFor = (stage: AccessStage): Role | null => {
      const id = String(props.player.id);
      if (stage.owner && String(stage.owner.id) === id) {
        return "owner";
      }
      let access;
      try {
        access = JSON.parse(stage.playerAccess ?? "null");
      } catch {
        return null;
      }
      if (!Array.isArray(access)) {
        return null;
      }
      const has = (group: unknown) =>
        Array.isArray(group) && group.some((entry) => String(entry) === id);
      if (has(access[1])) {
        return "editor";
      }
      if (has(access[0])) {
        return "player";
      }
      return null;
    };

    const rows = computed(() =>
      stages.value
        .map((stage) => ({ stage, role: roleFor(stage) }))
        .filter((row): row is { stage: AccessStage; role: Role } => row.role !== null)
        .sort(
          (a, b) =>
            ROLES[a.role].rank - ROLES[b.role].rank || a.stage.name.localeCompare(b.stage.name),
        ),
    );

    return { loading, error, rows, ROLES };
  },
};
</script>

<template>
  <Spin v-if="loading" size="small" />
  <p v-else-if="error" class="access-note">Could not load stages: {{ error }}</p>
  <p v-else-if="!rows.length" class="access-note">
    No stage access — this player can only enter stages as audience.
  </p>
  <ul v-else class="stage-access-list">
    <li v-for="{ stage, role } in rows" :key="stage.id">
      <a :href="`/${stage.fileLocation}`" target="_blank" rel="noopener">{{ stage.name }}</a>
      <Tag :color="ROLES[role].color">{{ ROLES[role].label }}</Tag>
    </li>
  </ul>
</template>

<style scoped>
/* Same cap as other scrollable dialog lists (~7 rows). */
.stage-access-list {
  max-height: min(17.5em, 35vh);
  overflow-y: auto;
  margin: 0;
}
.stage-access-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
}
.stage-access-list a {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stage-access-list :deep(.ant-tag) {
  margin-right: 0;
  flex-shrink: 0;
}
.access-note {
  margin: 0;
  color: rgba(0, 0, 0, 0.45);
}
</style>
