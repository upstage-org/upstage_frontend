import type { Page } from "@playwright/test";

export interface CreateStageOptions {
  name: string;
  /** Slug; goes into the live URL `/<slug>`. */
  fileLocation: string;
}

/**
 * Drives the /stages flow rendered by views/stages/**.
 *
 * The router mounts /stages/new-stage for create and
 * /stages/stage-management/:id for edit; we land on the latter after create()
 * succeeds because StageManagement/General.vue does the redirect.
 */
export class StageManagementPage {
  constructor(private readonly page: Page) {}

  async create({ name, fileLocation }: CreateStageOptions): Promise<string> {
    await this.page.goto("/stages/new-stage");
    await this.page.waitForLoadState("networkidle").catch(() => undefined);

    const nameInput = this.fieldInput("stage-name-input");
    await nameInput.waitFor({ state: "visible", timeout: 15_000 });
    await nameInput.fill(name);

    const urlInput = this.fieldInput("stage-url-input");
    await urlInput.fill(fileLocation);
    // Field has a debounced @input -> checkURL call; wait for the green check.
    await this.page
      .locator(".fa-check")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });

    const createBtn = this.page.locator('[data-testid="stage-create"]').first();
    await createBtn.click();

    // After create, router pushes to /stages/stage-management/:id/.
    await this.page.waitForURL(/\/stages\/stage-management\/\d+/, {
      timeout: 20_000,
    });
    const url = this.page.url();
    const match = url.match(/stage-management\/(\d+)/);
    if (!match) throw new Error(`Stage id not in URL: ${url}`);
    return match[1];
  }

  async openMediaTab(): Promise<void> {
    // The Customisation/Media/Archive tabs are router-link <a>s under the
    // stage-management layout.
    const link = this.page.getByRole("link", { name: /^Stage Media$|^Media$/i }).first();
    if (await link.count()) {
      await link.click();
    } else {
      await this.page.goto(`${this.page.url().replace(/\/$/, "")}/media`);
    }
    await this.page.waitForLoadState("networkidle").catch(() => undefined);
  }

  /**
   * The Reorder/MultiSelectList interface for stage-media assignment isn't
   * trivially scriptable through the DOM — use the `assignMedia` stage mutation
   * (see `src/services/graphql/stage.ts`) with the same absolute GraphQL origin
   * as `E2E_GRAPHQL_ENDPOINT` / `tests/e2e/graphql.ts`.
   */
  async assignMediaIds(stageId: string, mediaIds: string[]): Promise<number> {
    return this.page.evaluate(
      async ({ stageId, mediaIds }) => {
        const raw = window.localStorage.getItem("vuex");
        const token = raw ? (JSON.parse(raw)?.auth?.token ?? null) : null;
        if (!token) throw new Error("[e2e] no auth token in localStorage");
        // Same origin as the SPA (Vite proxy → studio API) — never hit :3001 from
        // a page on :3000 (CORS) unless the backend lists that origin.
        const graphQlEndpoint = new URL("studio_graphql", `${window.location.origin}/api/`).toString();

        const resp = await fetch(graphQlEndpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            query: `mutation Assign($id: ID!, $mediaIds: [ID]) {
              assignMedia(input: { id: $id, mediaIds: $mediaIds }) { id }
            }`,
            variables: {
              id: String(stageId),
              mediaIds: mediaIds.map((x) => String(x)),
            },
          }),
        });
        const text = await resp.text();
        if (!text?.trim()) {
          throw new Error(`[e2e] empty GraphQL response (${resp.status} ${resp.statusText})`);
        }
        const result = JSON.parse(text) as {
          errors?: ReadonlyArray<{ message?: string }>;
          data?: { assignMedia?: { id: string } };
        };
        if (result.errors && result.errors.length > 0) {
          throw new Error(`assignMedia failed: ${JSON.stringify(result.errors)}`);
        }
        return result.data?.assignMedia?.id ? mediaIds.length : 0;
      },
      { stageId, mediaIds },
    );
  }

  /**
   * Grants Player + edit access to all the named usernames in a single mutation.
   * Reuses the SPA's `updateStage` mutation exposed via the auth token.
   */
  async grantPlayerAccess(
    stageId: string,
    userIdsByLevel: { audience: string[]; player: string[]; playerEdit: string[] },
  ): Promise<void> {
    await this.page.evaluate(
      async ({ stageId, userIdsByLevel }) => {
        const raw = window.localStorage.getItem("vuex");
        const token = raw ? (JSON.parse(raw)?.auth?.token ?? null) : null;
        if (!token) throw new Error("[e2e] no auth token in localStorage");
        const endpoint = new URL("studio_graphql", `${window.location.origin}/api/`).toString();
        const playerAccess = JSON.stringify([
          userIdsByLevel.audience,
          userIdsByLevel.player,
          userIdsByLevel.playerEdit,
        ]);
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            query: `mutation UpdateStage($input: StageInput!) {
              updateStage(input: $input) { id }
            }`,
            variables: {
              input: {
                id: String(stageId),
                playerAccess,
              },
            },
          }),
        });
        const body = await resp.text();
        if (!body?.trim()) {
          throw new Error(`[e2e] empty GraphQL response on updateStage (${resp.status})`);
        }
        const result = JSON.parse(body) as { errors?: unknown };
        if (result.errors) {
          throw new Error(`updateStage failed: ${JSON.stringify(result.errors)}`);
        }
      },
      { stageId, userIdsByLevel },
    );
  }

  private fieldInput(testId: string): ReturnType<Page["locator"]> {
    // Field.vue passes its v-model down to a child input but the data-testid
    // lands on the wrapper; descend to the input.
    return this.page.locator(`[data-testid="${testId}"] input`).first();
  }
}
