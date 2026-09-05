/**
 * Upload limits through the real SPA + disposable e2e backend.
 *
 * 2026-09-05 report: a super admin was told "Your upload limit is 1.0 MB"
 * for a 1.2 MB multiframe frame, and changing a player's limit in Player
 * Management appeared to have no effect. Two defects:
 *   • Dropzone.vue misread the `refetch()` result shape on every drop after
 *     the first, so the gate silently fell back to the 1 MB default.
 *   • Admins were subject to the per-user cap at all (they must only be
 *     bound by the 500 MB server-wide / nginx `client_max_body_size` cap).
 *
 * Scenarios:
 *   1. admin: whoami reports the 500 MB server max; a 1.2 MB PNG passes the
 *      dropzone gate and saves as a prop.
 *   2. player, no change (1 MB default): a small file passes, then the
 *      1.2 MB file is refused on the SAME page (second-drop / refetch path).
 *   3. admin raises the player's limit to 2 MB: the 1.2 MB file now passes
 *      on the very next drop — no reload.
 *   4. admin lowers it back to 1 MB: refused again.
 *
 * Fixtures are generated on the fly: `big.png` is a real PNG (props/edict.png)
 * padded past 1.2 MiB with bytes after IEND, which decoders ignore — the
 * gate only looks at File.size, and the preview still renders.
 */

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadE2eConfig } from "./e2e-config";
import { gql, loginAsAdmin } from "./graphql";
import { LoginPage } from "./pages/LoginPage";
import { MediaLibraryPage } from "./pages/MediaLibraryPage";
import { ADMIN, findPersona } from "./personas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "..", "..", "test-results", "upload-limit");
const SOURCE_PNG = path.join(__dirname, "assets", "props", "edict.png");
const SMALL_PNG = path.join(FIXTURE_DIR, "small.png");
const BIG_PNG = path.join(FIXTURE_DIR, "big.png");

const MIB = 1024 * 1024;
const SERVER_MAX = 500 * MIB;
const ONE_POINT_TWO_MB = Math.round(1.2 * MIB);

/** A player no other spec relies on for media ownership. */
const PLAYER = findPersona("officer");

interface WhoAmI {
  id: string;
  username: string;
  email: string;
  role: string;
  active: boolean;
  uploadLimit: number | null;
  effectiveUploadLimit: number | null;
}

const WHOAMI = `query { whoami { id username email role active uploadLimit effectiveUploadLimit } }`;
const UPDATE_USER = `
  mutation UpdateUser($input: UpdateUserInput!) {
    updateUser(input: $input) { id uploadLimit }
  }
`;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const png = readFileSync(SOURCE_PNG);
  writeFileSync(SMALL_PNG, png);
  writeFileSync(BIG_PNG, Buffer.concat([png, Buffer.alloc(ONE_POINT_TWO_MB - png.length)]));
});

async function whoami(token: string): Promise<WhoAmI> {
  const res = await gql<{ whoami: WhoAmI }>(WHOAMI, {}, token);
  if (res.errors?.length || !res.data?.whoami) {
    throw new Error(`whoami failed: ${JSON.stringify(res.errors ?? res)}`);
  }
  return res.data.whoami;
}

async function setUploadLimit(adminToken: string, player: WhoAmI, limit: number): Promise<void> {
  const res = await gql<{ updateUser: { uploadLimit: number } }>(
    UPDATE_USER,
    {
      input: {
        id: Number(player.id),
        username: player.username,
        email: player.email,
        role: Number(player.role),
        active: player.active,
        uploadLimit: limit,
      },
    },
    adminToken,
  );
  if (res.errors?.length) throw new Error(`updateUser failed: ${JSON.stringify(res.errors)}`);
  expect(res.data?.updateUser.uploadLimit).toBe(limit);
}

async function loginAndGetToken(page: Page, username: string, password: string): Promise<string> {
  await new LoginPage(page).login(username, password);
  const token = await new LoginPage(page).getAuthToken();
  if (!token) throw new Error(`[e2e] no auth token after logging in as ${username}`);
  return token;
}

/** Click "+ New Media" and hand the dropzone a file (same path as MediaLibraryPage.upload). */
async function dropFile(page: Page, filePath: string): Promise<void> {
  await page
    .locator("button", { hasText: /\bnew\s+media\b/i })
    .first()
    .click();
  const input = page.locator('.fullscreen-dragzone input[type="file"]').first();
  await input.waitFor({ state: "attached", timeout: 10_000 });
  await input.setInputFiles(filePath);
}

const limitToast = (page: Page) =>
  page.locator(".ant-message-notice", { hasText: /Your upload limit is/ }).first();
const mediaFormType = (page: Page) => page.locator('[data-testid="media-form-type"]').first();

async function expectRefused(page: Page, limitLabel: string): Promise<void> {
  const toast = limitToast(page);
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await expect(toast).toContainText(`Your upload limit is ${limitLabel}`);
  await expect(mediaFormType(page)).toBeHidden();
  // The toast dismisses on click (Dropzone.vue onClick); clear it so the
  // next assertion cannot see a stale message.
  await toast.click();
  await expect(toast).toBeHidden({ timeout: 15_000 });
}

async function expectAccepted(page: Page): Promise<void> {
  await expect(mediaFormType(page)).toBeVisible({ timeout: 15_000 });
  await expect(limitToast(page)).toBeHidden();
}

/** Close MediaForm without saving (its "Are you sure you want to quit?" confirm). */
async function discardMediaForm(page: Page): Promise<void> {
  const modal = page
    .locator(".ant-modal")
    .filter({ has: mediaFormType(page) })
    .first();
  await modal.locator(".ant-modal-close").first().click();
  const confirm = page.locator(".ant-modal-confirm").filter({ hasText: /quit/i }).first();
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  await confirm.locator(".ant-modal-confirm-btns .ant-btn-primary").first().click();
  await expect(mediaFormType(page)).toBeHidden({ timeout: 15_000 });
}

test.describe("upload limits", () => {
  test("admin: 500 MB server max applies, a 1.2 MB file uploads", async ({ page }) => {
    const cfg = loadE2eConfig();
    const token = await loginAndGetToken(page, ADMIN.username, cfg.adminPassword);

    const me = await whoami(token);
    expect(Number(me.effectiveUploadLimit)).toBe(SERVER_MAX);

    const media = new MediaLibraryPage(page);
    await media.goto();
    await media.upload({
      filePath: BIG_PNG,
      name: `e2e-upload-limit-${Date.now()}`,
      mediaType: "prop",
      ownerUsername: ADMIN.username,
    });
    await expect(limitToast(page)).toBeHidden();
  });

  test("player: 1 MB default refuses 1.2 MB, an admin increase then decrease is honoured live", async ({
    page,
  }) => {
    const cfg = loadE2eConfig();
    const adminToken = await loginAsAdmin();
    const playerToken = await loginAndGetToken(page, PLAYER.username, cfg.playerPassword);
    const player = await whoami(playerToken);

    try {
      // No change: the default.
      await setUploadLimit(adminToken, player, MIB);
      expect(Number((await whoami(playerToken)).effectiveUploadLimit)).toBe(MIB);

      await new MediaLibraryPage(page).goto();

      // First drop on this page: a small frame is fine.
      await dropFile(page, SMALL_PNG);
      await expectAccepted(page);
      await discardMediaForm(page);

      // Second drop, same page: the 1.2 MB frame is refused at 1 MB.
      await dropFile(page, BIG_PNG);
      await expectRefused(page, "1.0 MB");

      // Admin raises the limit to 2 MB; no reload — the next drop must see it.
      await setUploadLimit(adminToken, player, 2 * MIB);
      await dropFile(page, BIG_PNG);
      await expectAccepted(page);
      await discardMediaForm(page);

      // Admin puts it back to 1 MB; refused again.
      await setUploadLimit(adminToken, player, MIB);
      await dropFile(page, BIG_PNG);
      await expectRefused(page, "1.0 MB");
    } finally {
      await setUploadLimit(adminToken, player, MIB);
    }
  });
});
