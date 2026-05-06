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
      assets { id }
    }
  }`;

  const r = await gql<{
    stage: {
      id: string | number;
      fileLocation: string;
      status: string | null;
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

  return { ok: true };
}
