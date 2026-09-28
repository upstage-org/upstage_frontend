// Browser check for Stage Management (views/stages/StageManagement: General,
// Customisation, Archive) and the cover image picker (components/form/ImagePicker.vue).
// Creates a throwaway stage through the form, edits it, and deletes it again.
//
// Needs the disposable e2e stack (tests/e2e/env/e2e-backend-up.sh + vite-e2e.sh).
//
//   node tests/e2e/scripts/stage-management/stage-management-check.cjs
const { chromium } = require("@playwright/test");
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const SHOTS = process.env.E2E_SHOT_DIR;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok ? "" : "  " + JSON.stringify(detail)));
};
const shot = (page, name) =>
  SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) : null;

async function gql(page, query, variables) {
  return page.evaluate(
    async ({ query, variables }) => {
      const token = JSON.parse(localStorage.getItem("upstage-auth") ?? "{}").token;
      const response = await fetch("/api/studio_graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
      });
      return response.json();
    },
    { query, variables },
  );
}
const storedStage = async (page, id) =>
  (
    await gql(
      page,
      "query($id: ID!) { stage(id: $id) { id name description status visibility attributes { name description } } }",
      { id },
    )
  ).data?.stage;
const attribute = (stage, name) => stage?.attributes?.find((a) => a.name === name)?.description;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const consoleErrors = [];
  // ant-design-vue deprecation notices come from other components on these pages.
  page.on(
    "console",
    (m) =>
      m.type() === "error" &&
      !m.text().startsWith("Warning: [ant-design-vue") &&
      consoleErrors.push(m.text()),
  );
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto(BASE + "/login");
  await page.locator('input[name="username"]').first().fill(ADMIN);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login")),
    page.locator('button[type="submit"]').first().click(),
  ]);

  const slug = `smc-${Date.now().toString(36)}`;
  let stageId;
  try {
    // --- General: create --------------------------------------------------
    await page.goto(BASE + "/stages/new-stage");
    const nameInput = page.locator('input[data-testid="stage-name-input"]');
    await nameInput.waitFor({ timeout: 30000 });
    const createButton = page.locator('[data-testid="stage-create"]');
    check("create is disabled until the URL is checked", await createButton.isDisabled());

    const urlInput = page.locator('input[data-testid="stage-url-input"]');
    // Field shows its error once the input was left.
    await urlInput.fill("not valid!");
    await urlInput.blur();
    check(
      "special characters in the URL are refused",
      await page
        .getByText("URL cannot contain special characters or spaces!")
        .waitFor({ timeout: 5000 })
        .then(
          () => true,
          () => false,
        ),
    );
    await urlInput.fill("login");
    check(
      "reserved paths are refused",
      await page
        .getByText("These URL are not allowed")
        .waitFor({ timeout: 5000 })
        .then(
          () => true,
          () => false,
        ),
    );

    await nameInput.fill("Stage management check");
    await urlInput.fill(slug);
    await page.locator(".fa-check").first().waitFor({ timeout: 10000 });
    check("a free URL gets the green check", true);
    await shot(page, "general-new");
    await createButton.click();
    await page.waitForURL(/\/stages\/stage-management\/\d+/, { timeout: 20000 });
    stageId = page.url().match(/stage-management\/(\d+)/)[1];
    let stored = await storedStage(page, stageId);
    check(
      "stage is created with the typed name",
      stored?.name === "Stage management check",
      stored,
    );

    // --- General: update --------------------------------------------------
    await page.locator('[data-testid="stage-save"]').waitFor({ timeout: 20000 });
    check("URL is locked on an existing stage", await urlInput.isDisabled());
    await page.locator("textarea.textarea").first().fill("Loading text from the check");

    const columns = page.locator("article.panel");
    await columns.first().locator("a.panel-block").first().waitFor({ timeout: 20000 });
    const moved = (await columns.nth(0).locator("a.panel-block").first().innerText()).trim();
    await columns.nth(0).locator("a.panel-block").first().click();
    check(
      "clicking a player moves them to Player access",
      (await columns.nth(1).locator("a.panel-block").allInnerTexts())
        .map((s) => s.trim())
        .includes(moved),
      moved,
    );
    check(
      "the owner is listed in the last column",
      (await columns.nth(2).locator("a.panel-block.owner").count()) === 1,
    );

    await page.locator('[data-testid="stage-save"]').click();
    await page.getByText("Stage updated successfully!").waitFor({ timeout: 15000 });
    stored = await storedStage(page, stageId);
    check(
      "description is saved",
      stored?.description === "Loading text from the check",
      stored?.description,
    );
    const access = JSON.parse(attribute(stored, "playerAccess") ?? "[]");
    check("player access is saved with one player", access[0]?.length === 1, access);

    await page.reload();
    await columns.first().locator("a.panel-block").first().waitFor({ timeout: 20000 });
    check(
      "player access is shown again after a reload",
      (await columns.nth(1).locator("a.panel-block").allInnerTexts())
        .map((s) => s.trim())
        .includes(moved),
    );
    await shot(page, "general-saved");

    // --- cover image picker -----------------------------------------------
    await page.getByRole("button", { name: /choose an image/i }).click();
    const picker = page.locator(".modal.is-active");
    await picker.waitFor({ timeout: 15000 });
    await picker.locator(".ant-table").waitFor({ timeout: 30000 });
    check("image picker opens with the media table", true);
    check(
      "image picker offers the filters",
      (await picker.locator(".ant-select").count()) >= 4 &&
        (await picker.locator(".ant-input-search").count()) === 1,
    );
    await shot(page, "image-picker");
    await picker.locator("button.delete").click();
    await picker.waitFor({ state: "detached", timeout: 10000 });
    check("image picker closes", true);

    // --- Customisation ----------------------------------------------------
    await page.getByRole("link", { name: /^Customisation$/i }).click();
    await page.getByText("Stage Ratio").waitFor({ timeout: 20000 });
    check(
      "default ratio is 16/9",
      (await page.locator("h3.title", { hasText: "Stage Ratio" }).innerText()).includes("16/9"),
    );
    // Selectable lays a hover overlay over its content; the click lands on that.
    await page.locator(".size-option", { hasText: "4/3" }).click({ force: true });
    check(
      "choosing 4/3 updates the heading",
      (await page.locator("h3.title", { hasText: "Stage Ratio" }).innerText()).includes("4/3"),
    );
    const sliders = page.locator("input.slider");
    await sliders.nth(0).evaluate((el) => {
      el.value = "0.5";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await sliders.nth(1).evaluate((el) => {
      el.value = "1";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const width = page.locator(".custom-ratio input").nth(0);
    await width.fill("5");
    await shot(page, "customisation");
    await page
      .locator("button", { hasText: /^\s*Save\s*$/i })
      .first()
      .click();
    await page.getByText("Customisation saved!").waitFor({ timeout: 15000 });
    stored = await storedStage(page, stageId);
    const config = JSON.parse(attribute(stored, "config") ?? "{}");
    check("ratio is saved", config.ratio?.width === 5 && config.ratio?.height === 3, config.ratio);
    check(
      "animation speeds are saved as numbers",
      config.animations?.bubbleSpeed === 2000 && config.animations?.curtainSpeed === 5000,
      config.animations,
    );
    check(
      "streaming settings are saved",
      config.enabledLiveStreaming === true && config.streamingMode === "both",
      config,
    );

    // --- Archive ----------------------------------------------------------
    await page.getByRole("link", { name: /^Archive$/i }).click();
    await page.locator("table.table").waitFor({ timeout: 20000 });
    check(
      "archive lists its columns",
      (await page.locator("table.table thead th").allInnerTexts())
        .join("|")
        .includes("Archived On"),
    );
    check(
      "a new stage has no recordings",
      (await page.locator("table.table tfoot").innerText()).includes("No replay recordings"),
    );
    await shot(page, "archive");

    // --- existing stage with performances, if the e2e run left one ----------
    let runtime;
    try {
      runtime = require("../../runtime.json");
    } catch {
      runtime = null;
    }
    if (runtime?.stageId) {
      await page.goto(`${BASE}/stages/stage-management/${runtime.stageId}/archive`);
      await page.locator("table.table").waitFor({ timeout: 20000 });
      const rows = await page.locator("table.table tbody tr").count();
      console.log(
        `INFO  e2e stage ${runtime.stageId} has ${rows} archive row(s) on the first page`,
      );
      if (rows) {
        const first = page.locator("table.table tbody tr").first();
        check(
          "archive rows are numbered and have actions",
          (await first.locator("td").first().innerText()).trim() === "1" &&
            (await first.locator("td.actions button").count()) >= 3,
        );
        await first.locator("td.public-chat button").first().click();
        await page.locator(".modal.is-active").waitFor({ timeout: 10000 });
        check(
          "audience chat of a performance opens",
          (await page.locator(".modal.is-active .modal-card-title").innerText()).includes(
            "Audience chats",
          ),
        );
        await page.locator(".modal.is-active button.delete").click();
        await shot(page, "archive-e2e-stage");
      }
    }
  } catch (e) {
    check("check ran to the end", false, String(e));
    await shot(page, "failure");
  } finally {
    if (stageId) {
      const deleted = await gql(page, "mutation($id: ID!) { deleteStage(id: $id) { success } }", {
        id: stageId,
      });
      check("throwaway stage is deleted", deleted.data?.deleteStage?.success === true, deleted);
    }
  }

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 5));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
