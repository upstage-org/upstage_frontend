// Browser check for components/editor/RichTextEditor.vue (tiptap) on the two
// pages that use it: admin configuration (foyer description, e-mail signature)
// and admin e-mail notification. Stored text must not change until somebody
// edits it, and an edit must reach the foyer.
//
// Needs the disposable e2e stack (tests/e2e/env/e2e-backend-up.sh + vite-e2e.sh).
// The foyer description is put back as it was at the end.
//
//   node tests/e2e/scripts/editor/rich-text-editor-check.cjs
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
const storedDescription = async (page) =>
  (await gql(page, "{ foyer { description { value } } }")).data.foyer.description?.value ?? "";
const saveDescription = (page, value) =>
  gql(
    page,
    "mutation($name: String!, $value: String!) { saveConfig(input: { name: $name, value: $value }) { id } }",
    { name: "FOYER_DESCRIPTION", value },
  );

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const consoleErrors = [];
  const requests = [];
  // ant-design-vue deprecation notices come from other components on these pages.
  page.on(
    "console",
    (m) =>
      m.type() === "error" &&
      !m.text().startsWith("Warning: [ant-design-vue") &&
      consoleErrors.push(m.text()),
  );
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("request", (r) => requests.push(r.url()));

  await page.goto(BASE + "/login");
  await page.locator('input[name="username"]').first().fill(ADMIN);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login")),
    page.locator('button[type="submit"]').first().click(),
  ]);

  const original = await storedDescription(page);
  let restored = false;
  try {
    // --- configuration: foyer description -------------------------------
    await page.goto(BASE + "/admin/configuration/foyer");
    const item = page.locator(".ant-form-item", { has: page.locator(".rich-text-editor") }).first();
    const content = item.locator(".rich-text-content");
    await content.waitFor({ timeout: 30000 });
    await page.waitForTimeout(1000);
    await shot(page, "config-readonly");
    check("editor renders the stored description", (await content.innerText()).trim().length > 0, {
      original,
    });
    check(
      "read-only until Edit is pressed",
      (await content.getAttribute("contenteditable")) === "false" &&
        (await item.locator('button[title="Bold"]').isDisabled()),
    );
    check("opening the page changed nothing", (await storedDescription(page)) === original);

    await item.getByRole("button", { name: "Edit", exact: true }).click();
    check("editable after Edit", (await content.getAttribute("contenteditable")) === "true");
    const warning = item.locator(".rich-text-warning");
    const expectsWarning = original.includes("<!--");
    check("warning matches the stored text", (await warning.count()) === (expectsWarning ? 1 : 0), {
      expectsWarning,
      text: await warning.allInnerTexts(),
    });

    // HTML mode shows the stored text itself.
    await item.locator('button[title="Edit as HTML"]').click();
    const source = item.locator("textarea.rich-text-source");
    check("HTML mode shows the stored text unchanged", (await source.inputValue()) === original);
    await item.locator('button[title="Edit as HTML"]').click();

    // Type, format, save.
    const marker = "editor check " + Date.now();
    // Caret to the very end; a click could land on (and select) an image.
    // Focus arrives a frame later; Enter before that would press the last button.
    await content.evaluate((node) => node.editor.commands.focus("end"));
    await page.waitForFunction(() =>
      document.activeElement?.classList.contains("rich-text-content"),
    );
    await page.keyboard.press("Enter");
    // A new line continues the format of the one above, which may be bold already.
    const bold = item.locator('button[title="Bold"]');
    const isBold = () => bold.evaluate((b) => b.classList.contains("active"));
    if (!(await isBold())) await bold.click();
    await page.keyboard.type(marker);
    await item.locator('button[title="Align centre"]').click();
    check(
      "toolbar shows the active format",
      await item.locator('button[title="Bold"]').evaluate((b) => b.classList.contains("active")),
    );
    await shot(page, "config-editing");
    await item.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(2500);
    const saved = await storedDescription(page);
    check(
      "saved text has the typed paragraph, bold and centred",
      saved.includes(`<p style="text-align: center;"><strong>${marker}</strong></p>`),
      { saved },
    );
    for (const kept of ["<h3", "<img", "<a "]) {
      check(
        `saved text keeps ${kept} of the stored text`,
        !original.includes(kept) || saved.includes(kept),
        { saved },
      );
    }

    // --- foyer shows it --------------------------------------------------
    await page.goto(BASE + "/");
    const foyer = page.locator(".describe .subtitle");
    await foyer.waitFor({ timeout: 30000 });
    check("foyer shows the typed text", (await foyer.innerText()).includes(marker));
    check(
      "foyer renders it bold and centred",
      await foyer.evaluate((node, marker) => {
        const strong = [...node.querySelectorAll("strong")].find((s) => s.textContent === marker);
        return (
          !!strong &&
          Number(getComputedStyle(strong).fontWeight) >= 600 &&
          getComputedStyle(strong.parentElement).textAlign === "center"
        );
      }, marker),
    );
    await shot(page, "foyer");

    // --- e-mail notification --------------------------------------------
    await page.goto(BASE + "/admin/email-notification");
    const body = page.locator(".rich-text-content").first();
    await body.waitFor({ timeout: 30000 });
    check(
      "e-mail body shows the placeholder",
      (await body.locator("p.is-editor-empty").getAttribute("data-placeholder")) ===
        "Write something...",
    );
    await body.click();
    await page.keyboard.type("Hello ");
    await page.locator('button[title="Italic"]').click();
    await page.keyboard.type("players");
    await page.locator('button[title="Insert table"]').click();
    check(
      "table tools appear inside a table",
      await page.locator('button[title="Delete table"]').isVisible(),
    );
    await page.locator('button[title="Edit as HTML"]').click();
    const html = await page.locator("textarea.rich-text-source").inputValue();
    check(
      "e-mail body HTML",
      html.startsWith("<p>Hello <em>players</em></p><table") && html.includes("border: 1px solid"),
      { html },
    );
    await shot(page, "email");
  } finally {
    await saveDescription(page, original);
    restored = (await storedDescription(page)) === original;
  }
  check("foyer description put back", restored);
  check(
    "no TinyMCE request",
    !requests.some((url) => /tinymce/i.test(url)),
    requests.filter((url) => /tinymce/i.test(url)),
  );
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 10));

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
