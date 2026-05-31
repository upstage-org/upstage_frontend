import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import tsconfigPaths from "vite-tsconfig-paths";
import Components from "unplugin-vue-components/vite";
import AutoImport from "unplugin-auto-import/vite";
import VueDevTools from "vite-plugin-vue-devtools";
import { AntDesignVueResolver } from "unplugin-vue-components/resolvers";

/**
 * Hostname for `preview.allowedHosts` from the base URL (`origin`) of
 * `VITE_GRAPHQL_ENDPOINT` only — path, query string, and hash are ignored
 * (e.g. `https://dev.upstage.live/api/graphql?x=1` → `dev.upstage.live`).
 */
function previewAllowedHostsFromGraphqlEndpoint(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = new URL(raw.trim());
    const base = new URL(parsed.origin);
    return base.hostname ? [base.hostname] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * MIME map for uploaded media; matches the extensions the backend's
 * FileHandling.validate_file_size accepts. Anything not listed falls back to
 * application/octet-stream, which still streams correctly but lets the
 * browser handle it generically.
 */
const UPLOAD_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".flv": "video/x-flv",
  ".3gp": "video/3gpp",
  ".mp3": "audio/mpeg",
  ".mpeg": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".aacp": "audio/aac",
};

/**
 * Mount a host directory at a URL prefix on the Vite dev server.
 *
 * Production / `--build` mode: the host nginx serves uploaded media via
 * `alias /resources -> /app_code_${SITE}/uploads` (see
 * `prod_copy/upstage_backend/initial_scripts/nginx_templates/nginx_template_for_app_machines.conf`).
 * `--serve` mode has no nginx in front of Vite, so without this plugin every
 * `/resources/<file>` request 404s. This plugin reads
 * `LOCAL_SERVE_STATIC_CONTENT` (filesystem path) and serves it at
 * `VITE_STATIC_ASSETS_ENDPOINT` (URL prefix, default `/resources/`).
 *
 * Build-mode bundles are unaffected: `apply: "serve"` scopes the plugin to
 * `vite dev` only.
 */
function localStaticContentPlugin(opts: { dir: string; urlPrefix: string }): Plugin {
  return {
    name: "upstage-local-static-content",
    apply: "serve",
    configureServer(server) {
      const absDir = path.resolve(opts.dir);
      // Connect middleware: trailing slash is stripped from the mount, leading
      // slash is required.
      const mount = "/" + opts.urlPrefix.replace(/^\/+|\/+$/g, "");
      if (mount === "/") {
        throw new Error(
          `[upstage] VITE_STATIC_ASSETS_ENDPOINT must not be empty or "/"; ` +
            `got "${opts.urlPrefix}". Set it to a non-empty path prefix ` +
            `(e.g. "/resources/") in env_backup_<site>.`,
        );
      }
      if (!fs.existsSync(absDir)) {
        server.config.logger.warn(
          `[upstage] LOCAL_SERVE_STATIC_CONTENT (${absDir}) does not exist yet; ` +
            `${mount}/* will 404 until the backend creates it or you upload a file.`,
        );
        return;
      }
      server.config.logger.info(`[upstage] dev: serving ${mount}/* from ${absDir}`);
      server.middlewares.use(mount, (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          return next();
        }
        const reqUrl = req.url ?? "/";
        const urlPath = decodeURIComponent(reqUrl.split("?")[0]);
        // Normalize then strip any leading slashes to prevent absolute-path
        // join, then path.join clamps the result inside absDir; the explicit
        // prefix check below is the final containment guarantee.
        const safe = path.posix.normalize("/" + urlPath).replace(/^\/+/, "");
        const filePath = path.join(absDir, safe);
        if (filePath !== absDir && !filePath.startsWith(absDir + path.sep)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        fs.stat(filePath, (err, stat) => {
          if (err || !stat.isFile()) {
            return next();
          }
          const ext = path.extname(filePath).toLowerCase();
          const ct = UPLOAD_MIME[ext] ?? "application/octet-stream";
          res.setHeader("Content-Type", ct);
          res.setHeader("Content-Length", String(stat.size));
          res.setHeader("Cache-Control", "no-cache, must-revalidate");
          res.setHeader("Last-Modified", stat.mtime.toUTCString());
          if (req.method === "HEAD") {
            res.end();
            return;
          }
          fs.createReadStream(filePath).pipe(res);
        });
      });
    },
  };
}

/** Studio REST/GraphQL for same-origin `/api` in dev and when serving a built app via `pnpm serve:dist`. */
const studioApiTarget = process.env.VITE_STUDIO_API_PROXY ?? "http://127.0.0.1:9090";

/** Port for `vite preview` / `pnpm serve:dist` (e.g. `FRONTEND_PORT` from docker compose). */
const previewPort = Number(process.env.FRONTEND_PORT) || 4173;

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const previewAllowedHosts = previewAllowedHostsFromGraphqlEndpoint(env.VITE_GRAPHQL_ENDPOINT);

  // In `vite dev` (--serve), the host nginx is not in front of us, so we have
  // to serve uploaded media ourselves. Refuse to start the dev server if the
  // operator hasn't said where it lives — silently 404ing every image and
  // audio file in the UI is far worse than failing loudly here.
  //
  // Vitest also invokes Vite with `command === "serve"` to build its module
  // graph, but defaults `mode` to "test"; CI runs `pnpm run test` without an
  // .env file, so we must skip the guard there. The local static-content
  // plugin is `apply: "serve"`-scoped and harmless under Vitest.
  const localServeStaticContent = env.LOCAL_SERVE_STATIC_CONTENT;
  if (command === "serve" && mode !== "test" && !localServeStaticContent) {
    throw new Error(
      "[upstage] LOCAL_SERVE_STATIC_CONTENT is not set in .env.\n" +
        "  This var is required for `vite dev` (run_front_end_*.sh --serve) so the\n" +
        "  dev server can serve uploaded media at VITE_STATIC_ASSETS_ENDPOINT.\n" +
        "  Set it in env_backup_<site> to the absolute filesystem path of the\n" +
        "  uploads directory (e.g. LOCAL_SERVE_STATIC_CONTENT=/app_code_dev/uploads).\n" +
        "  The run scripts copy env_backup_<site> to ./.env before invoking Vite.",
    );
  }

  return {
    base: "/",
    plugins: [
      vue(),
      VueDevTools(),
      tsconfigPaths(),
      AutoImport({
        imports: ["vue", "vue-router", "pinia", "@vueuse/core", { "vue-i18n": ["useI18n"] }],
        dts: "src/auto-imports.d.ts",
        eslintrc: { enabled: true },
      }),
      Components({
        resolvers: [AntDesignVueResolver({ importStyle: "less", resolveIcons: true })],
      }),
      // Only registered when LOCAL_SERVE_STATIC_CONTENT is set (we threw above
      // for `command === "serve"` without it). In `command === "build"` the
      // value may be absent and the plugin self-disables via `apply: "serve"`.
      ...(localServeStaticContent
        ? [
            localStaticContentPlugin({
              dir: localServeStaticContent,
              urlPrefix: env.VITE_STATIC_ASSETS_ENDPOINT || "/resources/",
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      proxy: {
        "/api": {
          target: studioApiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: previewPort,
      strictPort: true,
      ...(previewAllowedHosts ? { allowedHosts: previewAllowedHosts } : {}),
      proxy: {
        "/api": {
          target: studioApiTarget,
          changeOrigin: true,
        },
      },
    },
    css: {
      preprocessorOptions: {
        less: {
          javascriptEnabled: true,
        },
      },
    },
  };
});
