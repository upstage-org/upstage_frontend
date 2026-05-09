/**
 * Serves built Vue static assets from dist/ and reverse-proxies /api to the studio backend.
 * Runs inside the production-style frontend Docker image (not Vite dev).
 *
 * Env (both required):
 *   - STATIC_API_LISTEN_PORT: TCP port this process binds to (container side of compose host:container).
 *   - FRONTEND_PORT: host-published port from the same compose mapping (for logs; not the bind port).
 *   - VITE_STUDIO_API_PROXY: backend base URL for /api reverse proxy.
 */
import http from "node:http";
import httpProxy from "http-proxy";
import sirv from "sirv";

function parsePort(name, raw) {
  if (raw === undefined || raw === "") {
    console.error(`static-api-server: ${name} must be set`);
    process.exit(1);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error(`static-api-server: ${name} must be a valid TCP port number`);
    process.exit(1);
  }
  return n;
}

const listenPort = parsePort(
  "STATIC_API_LISTEN_PORT",
  process.env.STATIC_API_LISTEN_PORT,
);
const publishedHostPort = parsePort("FRONTEND_PORT", process.env.FRONTEND_PORT);

const apiTarget =
  process.env.VITE_STUDIO_API_PROXY || "http://127.0.0.1:3001";

const staticHandler = sirv("dist", {
  etag: true,
  single: true,
});

const proxy = httpProxy.createProxyServer({
  target: apiTarget,
  changeOrigin: true,
});

proxy.on("error", (err, _req, res) => {
  console.error("proxy error:", err);
  if (res && !res.headersSent && typeof res.writeHead === "function") {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Gateway");
  }
});

const server = http.createServer((req, res) => {
  const url = req.url ?? "";
  if (url === "/api" || url.startsWith("/api/")) {
    proxy.web(req, res);
    return;
  }
  staticHandler(req, res, () => {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not Found");
  });
});

server.listen(listenPort, "0.0.0.0", () => {
  console.log(
    `static-api-server listening on 0.0.0.0:${listenPort} (browser: host:${publishedHostPort}) api-> ${apiTarget}`,
  );
});
