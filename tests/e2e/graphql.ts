import "./e2e-env-bootstrap";

/**
 * Tiny zero-dep GraphQL client for the e2e harness. We deliberately do NOT
 * pull in @apollo/client here so the harness can run in Node without the SPA's
 * polyfill chain.
 *
 * Resolved URLs and credentials come from `e2e-config.ts` (`loadE2eConfig`)
 * after `.env.test` loading via `e2e-env-bootstrap`.
 */

import { chromium, type Browser } from "@playwright/test";

import { getE2eGraphQlEndpoint, loadE2eConfig } from "./e2e-config";
import { LoginPage } from "./pages/LoginPage";

export { getE2eGraphQlEndpoint };

export interface GqlResult<T> {
  data?: T;
  errors?: Array<{ message: string; path?: unknown }>;
}

export async function gql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string,
): Promise<GqlResult<T>> {
  const endpoint = getE2eGraphQlEndpoint();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status} from ${endpoint}: ${await res.text()}`);
  }
  return (await res.json()) as GqlResult<T>;
}

function captchaBlockedLoginError(errors: GqlResult<unknown>["errors"], data: unknown): boolean {
  const msg = JSON.stringify(errors ?? data).toLowerCase();
  return msg.includes("not a human") || msg.includes("missing-input-response");
}

/** Build login payload; Turnstile token is test-harness only (never used by the SPA). */
export function buildLoginPayload(
  username: string,
  password: string,
  captchaToken?: string,
): Record<string, string> {
  const payload: Record<string, string> = { username, password };
  if (captchaToken) {
    payload.token = captchaToken;
  }
  return payload;
}

async function loginAsAdminViaGraphql(captchaToken?: string): Promise<string> {
  const { adminUsername: username, adminPassword: password } = loadE2eConfig();
  const result = await gql<{
    login: { access_token: string; refresh_token: string; username: string };
  }>(
    `mutation Login($payload: LoginInput!) {
       login(payload: $payload) { access_token refresh_token username }
     }`,
    { payload: buildLoginPayload(username, password, captchaToken) },
  );
  if (result.errors?.length || !result.data?.login?.access_token) {
    const err = new Error(`Admin login failed: ${JSON.stringify(result.errors ?? result.data)}`);
    (err as Error & { captchaBlocked?: boolean }).captchaBlocked = captchaBlockedLoginError(
      result.errors,
      result.data,
    );
    throw err;
  }
  return result.data.login.access_token;
}

/**
 * Browser fallback for global-setup when Production captcha blocks headless
 * GraphQL login and no `E2E_CAPTCHA_TOKEN` was supplied. The SPA must expose
 * Turnstile (typically `VITE_ENV_TYPE=Production` on the dev server).
 */
async function loginAsAdminViaBrowser(): Promise<string> {
  const cfg = loadE2eConfig();
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ baseURL: cfg.baseUrl });
    const page = await context.newPage();
    const login = new LoginPage(page);
    try {
      await login.login(cfg.adminUsername, cfg.adminPassword);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("Timeout") || msg.includes("timeout")) {
        throw new Error(
          "[e2e] Turnstile did not resolve during browser login fallback. " +
            "Set E2E_CAPTCHA_TOKEN in .env.test instead (copy a fresh token from the login widget after it completes).",
        );
      }
      throw e;
    }
    const token = await login.getAuthToken();
    if (!token) {
      throw new Error(
        "[e2e] browser login completed but no JWT in localStorage — captcha may not have resolved",
      );
    }
    return token;
  } finally {
    await browser?.close().catch(() => {});
  }
}

export async function loginAsAdmin(): Promise<string> {
  const cfg = loadE2eConfig();
  try {
    return await loginAsAdminViaGraphql(cfg.captchaToken);
  } catch (err) {
    const captchaBlocked = Boolean((err as Error & { captchaBlocked?: boolean }).captchaBlocked);
    if (!captchaBlocked || cfg.captchaToken) {
      if (captchaBlocked && cfg.captchaToken) {
        throw new Error(
          `${(err as Error).message}\n[e2e] E2E_CAPTCHA_TOKEN was set but rejected — supply a fresh Turnstile token.`,
        );
      }
      throw err;
    }

    const canUseBrowser = Boolean(process.env.DISPLAY) && !cfg.headless;
    if (!canUseBrowser) {
      throw new Error(
        `${(err as Error).message}\n[e2e] Set E2E_CAPTCHA_TOKEN in .env.test when the backend requires Turnstile ` +
          "(test-harness only). Tokens expire quickly — copy a fresh value from the login widget after it resolves.",
      );
    }

    console.warn(
      "[e2e] GraphQL admin login blocked by Turnstile — falling back to browser login " +
        "(set E2E_CAPTCHA_TOKEN in .env.test to skip this path).",
    );
    return loginAsAdminViaBrowser();
  }
}
