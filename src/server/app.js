const fs = require("fs");
const path = require("path");
const { handleApiRequest } = require("./routes/api");
const { resolveUserFromRequest } = require("./auth");
const { runWithRequestContext } = require("./request-context");
const logger = require("./platform/logger");
const { getRuntimeConfig } = require("./platform/runtime");

const publicDir = path.join(__dirname, "..", "..", "public");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function serveStaticFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  const contentType = contentTypes[ext] || "text/plain; charset=utf-8";
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  const currentUser = resolveUserFromRequest(req);
  const startedAt = Date.now();
  const runtime = getRuntimeConfig();

  res.on("finish", () => {
    if (pathname.startsWith("/api/")) {
      logger.info("http.request", {
        method: req.method,
        pathname,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        userId: currentUser?.id || null,
        runtime: runtime.runtime
      });
    }
  });

  if (pathname.startsWith("/api/")) {
    const handled = await runWithRequestContext({ userId: currentUser?.id || null }, () =>
      handleApiRequest(req, res, pathname)
    );
    if (handled === false) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "API route not found." } }));
    }
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    serveStaticFile(res, path.join(publicDir, "index.html"));
    return;
  }

  serveStaticFile(res, path.join(publicDir, pathname));
}

module.exports = { handleRequest };
