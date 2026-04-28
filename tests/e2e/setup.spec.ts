import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ADMIN, PERSONAS, type Persona } from "./personas";
import { gql, loginAsAdmin } from "./graphql";
import { LiveStagePage } from "./pages/LiveStagePage";
import { LoginPage } from "./pages/LoginPage";
import { MediaLibraryPage } from "./pages/MediaLibraryPage";
import { StageManagementPage } from "./pages/StageManagementPage";
import { writeRuntime, type MediaRef } from "./fixtures/runtime";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSET_ROOT = path.join(__dirname, "assets");
const PORTRAIT_DIR = path.join(ASSET_ROOT, "portraits");
const BACKDROP_DIR = path.join(ASSET_ROOT, "backdrops");
const PROP_DIR = path.join(ASSET_ROOT, "props");

interface UploadSpec {
  filePath: string;
  name: string;
  mediaType: "avatar" | "prop" | "media" | "scene" | "backdrop";
  ownerUsername: string;
}

function planUploads(runId: string): {
  personas: Array<UploadSpec & { persona: Persona }>;
  props: UploadSpec[];
  backdrops: UploadSpec[];
} {
  const tag = runId.slice(0, 12);

  const personas = PERSONAS.map<UploadSpec & { persona: Persona }>((persona) => ({
    persona,
    filePath: path.join(PORTRAIT_DIR, persona.avatar),
    name: `${persona.username}-${tag}`,
    mediaType: "avatar",
    ownerUsername: persona.username,
  }));

  const props: UploadSpec[] = [
    {
      filePath: path.join(PROP_DIR, "swords.png"),
      name: `swords-${tag}`,
      mediaType: "prop",
      ownerUsername: ADMIN.username,
    },
    {
      filePath: path.join(PROP_DIR, "edict.png"),
      name: `edict-${tag}`,
      mediaType: "prop",
      ownerUsername: ADMIN.username,
    },
  ];

  const backdrops: UploadSpec[] = [
    {
      filePath: path.join(BACKDROP_DIR, "verona-street.png"),
      name: `verona-street-${tag}`,
      mediaType: "backdrop",
      ownerUsername: ADMIN.username,
    },
    {
      filePath: path.join(BACKDROP_DIR, "capulet-gate.png"),
      name: `capulet-gate-${tag}`,
      mediaType: "backdrop",
      ownerUsername: ADMIN.username,
    },
  ];

  for (const u of [...personas, ...props, ...backdrops]) {
    if (!existsSync(u.filePath)) {
      throw new Error(
        `[e2e] missing asset ${u.filePath}. Run 'pnpm e2e:assets' to regenerate.`,
      );
    }
  }
  return { personas, props, backdrops };
}

test.describe("setup: author the Romeo & Juliet stage", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(15 * 60_000);

  test("admin uploads media, creates the stage, and grants player access", async ({ page }) => {
    const runId = process.env.E2E_RUN_ID ?? `${Date.now()}`;
    const { personas, props, backdrops } = planUploads(runId);

    const login = new LoginPage(page);
    await login.login(ADMIN.username, ADMIN.password);

    const adminToken = (await login.getAuthToken()) ?? (await loginAsAdmin());

    const library = new MediaLibraryPage(page);
    await library.goto();

    const mediaByPersona: Record<string, MediaRef> = {};
    for (const u of personas) {
      await library.upload({
        filePath: u.filePath,
        name: u.name,
        mediaType: u.mediaType,
        ownerUsername: u.ownerUsername,
      });
      mediaByPersona[u.persona.username] = await fetchMediaIdByName(
        adminToken,
        u.name,
        u.ownerUsername,
        u.mediaType,
      );
    }

    const propRefs: Record<string, MediaRef> = {};
    for (const u of props) {
      await library.upload({
        filePath: u.filePath,
        name: u.name,
        mediaType: u.mediaType,
        ownerUsername: u.ownerUsername,
      });
      const key = path.basename(u.filePath, ".png");
      propRefs[key] = await fetchMediaIdByName(
        adminToken,
        u.name,
        u.ownerUsername,
        u.mediaType,
      );
    }

    const backdropRefs: Record<string, MediaRef> = {};
    for (const u of backdrops) {
      await library.upload({
        filePath: u.filePath,
        name: u.name,
        mediaType: u.mediaType,
        ownerUsername: u.ownerUsername,
      });
      const key = path.basename(u.filePath, ".png");
      backdropRefs[key] = await fetchMediaIdByName(
        adminToken,
        u.name,
        u.ownerUsername,
        u.mediaType,
      );
    }

    const stageMgmt = new StageManagementPage(page);
    const stageSlug = `r-and-j-a1s1-${runId.slice(0, 12)}`.toLowerCase();
    const stageId = await stageMgmt.create({
      name: `R&J A1S1 ${runId.slice(0, 8)}`,
      fileLocation: stageSlug,
    });

    const allMediaIds = [
      ...Object.values(mediaByPersona).map((m) => m.id),
      ...Object.values(propRefs).map((m) => m.id),
      ...Object.values(backdropRefs).map((m) => m.id),
    ];
    const updated = await stageMgmt.assignMediaIds(stageId, allMediaIds);
    expect(updated, "All Romeo & Juliet media should be assigned to the stage")
      .toBeGreaterThanOrEqual(allMediaIds.length);

    const playerIds = await fetchUserIdsByUsername(
      adminToken,
      personas.map((p) => p.persona.username),
    );
    await stageMgmt.grantPlayerAccess(stageId, {
      audience: [],
      player: [],
      playerEdit: Object.values(playerIds),
    });

    // Rehearsal + !canPlay shows "not currently open to the public" (Preloader).
    // Live status allows the public track and the admin/observer in perform to proceed.
    await setStageStatusLive(adminToken, stageId);

    // Resolve the real `fileLocation` from the API by id (avoids any mismatch
    // between the URL we typed in the form and `stageList(fileLocation: …)` in
    // a given DB/engine); then open the same path the `ListStage` query will use.
    const effectiveSlug = await waitForStageFileLocationById(adminToken, stageId);

    // Full-screen preloader (Preloader.vue) must be clicked off before the board
    // is visible — same as LiveStagePage.goto; MQTT connects in parallel.
    const live = new LiveStagePage(page);
    await live.goto(effectiveSlug);
    await page.screenshot({
      path: path.join(__dirname, "..", "..", "test-results", "setup-final.png"),
      fullPage: true,
    });

    writeRuntime({
      runId,
      stageId,
      stageSlug: effectiveSlug,
      stageUrl: `/${effectiveSlug}`,
      mediaByPersona,
      props: propRefs,
      backdrops: backdropRefs,
      adminToken,
      timestamp: new Date().toISOString(),
    });
  });
});

async function setStageStatusLive(token: string, stageId: string): Promise<void> {
  const r = await gql<{ updateStage: { id: string } }>(
    `mutation E2eSetStageLive($input: StageInput!) {
      updateStage(input: $input) { id }
    }`,
    {
      input: {
        id: String(stageId),
        status: "live",
      },
    },
    token,
  );
  if (r.errors?.length) {
    throw new Error(`[e2e] setStageStatusLive failed: ${JSON.stringify(r.errors)}`);
  }
}

/**
 * Wait until the authenticated `stage(id)` query returns `fileLocation` (same
 * source the SPA can rely on for live routing).
 */
async function waitForStageFileLocationById(
  token: string,
  stageId: string,
  timeoutMs = 90_000,
): Promise<string> {
  const query = `query E2eStageFileLocation($id: ID!) {
    stage(id: $id) { fileLocation }
  }`;
  const start = Date.now();
  let lastErr: string | undefined;
  while (Date.now() - start < timeoutMs) {
    const r = await gql<{
      stage: { fileLocation: string } | null;
    }>(query, { id: String(stageId) }, token);
    if (r.errors?.length) {
      lastErr = JSON.stringify(r.errors);
    } else {
      const loc = r.data?.stage?.fileLocation;
      if (typeof loc === "string" && loc.length > 0) {
        return loc;
      }
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(
    `[e2e] stage(id=${stageId}) never returned fileLocation within ${timeoutMs}ms. ` +
      `Last GraphQL: ${lastErr ?? "no errors but empty data"}`,
  );
}

async function fetchMediaIdByName(
  token: string,
  name: string,
  owner: string,
  mediaType: string,
): Promise<MediaRef> {
  // Use `media` (paged) so we can match on name + owner + type like the app’s media
  // table; `mediaList` is a simple filter and can miss rows right after save.
  const input = {
    page: 1,
    limit: 50,
    name,
    mediaTypes: [mediaType],
    owners: [owner],
  };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await gql<{
      media: { edges: Array<{ id: string; name: string }> };
    }>(
      `query MediaByName($input: MediaTableInput!) {
         media(input: $input) {
           edges { id name }
         }
       }`,
      { input },
      token,
    );
    const list = result.data?.media?.edges ?? [];
    const node = list.find((m) => m.name === name);
    if (node) {
      return { id: String(node.id), name: node.name };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `[e2e] uploaded media not found by name "${name}" (owner=${owner}, type=${mediaType})`,
  );
}

async function fetchUserIdsByUsername(
  token: string,
  usernames: string[],
): Promise<Record<string, string>> {
  const wanted = new Set(usernames.map((u) => u.toLowerCase()));
  const result = await gql<{ users: Array<{ id: string; username: string }> }>(
    `query Users { users(active: true) { id username } }`,
    {},
    token,
  );
  const out: Record<string, string> = {};
  for (const u of result.data?.users ?? []) {
    if (wanted.has(u.username.toLowerCase())) out[u.username.toLowerCase()] = String(u.id);
  }
  for (const u of usernames) {
    if (!out[u.toLowerCase()]) {
      throw new Error(`[e2e] user not found in 'users' query: ${u}`);
    }
  }
  return out;
}
