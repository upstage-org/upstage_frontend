import { getE2eGraphQlEndpoint, gql } from "../graphql";
import type { RuntimeState } from "./runtime";

function collectExpectedMediaIds(state: RuntimeState): Set<string> {
  const ids = new Set<string>();
  for (const m of Object.values(state.mediaByPersona)) ids.add(String(m.id));
  for (const m of Object.values(state.props)) ids.add(String(m.id));
  for (const m of Object.values(state.backdrops)) ids.add(String(m.id));
  return ids;
}

/**
 * Returns whether {@link runtime.json} still matches the live Studio API (same
 * stage, live status, and all expected media attached).
 */
export async function validateRuntimeStateForReuse(
  state: RuntimeState,
  adminToken: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const endpoint = getE2eGraphQlEndpoint();
  if (state.graphqlEndpoint && state.graphqlEndpoint !== endpoint) {
    return {
      ok: false,
      reason: `graphql endpoint mismatch (file=${state.graphqlEndpoint} vs env=${endpoint})`,
    };
  }

  const expected = collectExpectedMediaIds(state);
  if (expected.size === 0) {
    return { ok: false, reason: "runtime has no media ids" };
  }

  const query = `query E2eValidateStage($id: ID!) {
    stage(id: $id) {
      id
      fileLocation
      status
      playerAccess
      assets { id }
    }
  }`;

  const r = await gql<{
    stage: {
      id: string | number;
      fileLocation: string;
      status: string | null;
      playerAccess: string | null;
      assets: Array<{ id: string | number }>;
    } | null;
  }>(query, { id: String(state.stageId) }, adminToken);

  if (r.errors?.length) {
    return { ok: false, reason: `stage query: ${JSON.stringify(r.errors)}` };
  }
  const stage = r.data?.stage;
  if (!stage) {
    return { ok: false, reason: `stage id ${state.stageId} not found` };
  }
  if (String(stage.id) !== String(state.stageId)) {
    return { ok: false, reason: "stage id mismatch" };
  }
  if (stage.fileLocation !== state.stageSlug) {
    return {
      ok: false,
      reason: `fileLocation mismatch (api=${stage.fileLocation} vs runtime=${state.stageSlug})`,
    };
  }
  const st = stage.status;
  if (typeof st !== "string" || st.toLowerCase() !== "live") {
    return { ok: false, reason: `stage not live (status=${String(st)})` };
  }

  const onStage = new Set((stage.assets ?? []).map((a) => String(a.id)));
  for (const id of expected) {
    if (!onStage.has(id)) {
      return { ok: false, reason: `media id ${id} not on stage assets` };
    }
  }

  // The backend `stage_operation_service.resolve_permission` only honors a
  // 2-element `playerAccess` JSON list (`[playerIds, editorIds]`). Anything
  // else — `null`, empty string, the legacy 3-element list, or a 2-element
  // list with both buckets empty — falls through to "audience" for every
  // user, which makes `getters.canPlay` false in the SPA. The visible symptom
  // is the SPEAK MQTT side-channel silently no-opping (no `Topping.vue`
  // bubbles, no TTS); the test-side symptom is `speakAsAvatar` throwing
  // `canPlay=false` on the first speech beat. We treat any of these as a
  // re-authoring trigger so a stale stage gets rewritten with the correct
  // shape (and a non-empty player/editor bucket) on the next setup run.
  const accessRaw = stage.playerAccess;
  if (accessRaw == null || (typeof accessRaw === "string" && accessRaw.length === 0)) {
    return {
      ok: false,
      reason: `stage ${state.stageId} has no playerAccess set (got ${
        accessRaw === null ? "null" : "empty string"
      }); backend resolve_permission falls through to "audience" for every persona`,
    };
  }
  if (typeof accessRaw !== "string") {
    return {
      ok: false,
      reason: `playerAccess is not a string (got ${typeof accessRaw})`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(accessRaw);
  } catch {
    return { ok: false, reason: `playerAccess is not valid JSON: ${accessRaw}` };
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    return {
      ok: false,
      reason: `playerAccess is not a 2-element list (got length ${
        Array.isArray(parsed) ? parsed.length : "non-array"
      }); backend resolve_permission falls through to "audience"`,
    };
  }
  const [playerBucket, editorBucket] = parsed as [unknown, unknown];
  if (!Array.isArray(playerBucket) || !Array.isArray(editorBucket)) {
    return {
      ok: false,
      reason: `playerAccess buckets are not arrays (got [${typeof playerBucket}, ${typeof editorBucket}])`,
    };
  }
  if (playerBucket.length === 0 && editorBucket.length === 0) {
    return {
      ok: false,
      reason: `playerAccess has both buckets empty; nobody is granted player or editor — every persona resolves to "audience"`,
    };
  }

  return { ok: true };
}
