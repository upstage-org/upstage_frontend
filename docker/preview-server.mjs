/**
 * Minimal static server for dist/ + /api reverse proxy (replaces vite preview in Docker).
 * Env: FRONTEND_PORT (required), VITE_STUDIO_API_PROXY (backend base URL).
 */
import http from "node:http";
import httpProxy from "http-proxy";
import sirv from "sirv";

const portRaw = process.env.FRONTEND_PORT;
if (portRaw === undefined || portRaw === "") {
  console.error("preview-server: FRONTEND_PORT must be set");
  process.exit(1);
}
const port = Number(portRaw);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("preview-server: FRONTEND_PORT must be a valid TCP port number");
  process.exit(1);
}

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

server.listen(port, "0.0.0.0", () => {
  console.log(
    `preview-server listening on 0.0.0.0:${port} api-> ${apiTarget}`,
  );
});
