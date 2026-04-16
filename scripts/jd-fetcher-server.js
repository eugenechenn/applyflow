const { createServer } = require("http");
const { fetchJobPageWithPlaywright } = require("./lib/playwright-fetcher");

const DEFAULT_PORT = 4123;
const DEFAULT_HOST = "0.0.0.0";

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function createJdFetcherServer() {
  return createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return sendJson(res, 200, { ok: true, service: "jd-fetcher" });
      }

      if (req.method === "POST" && req.url === "/fetch") {
        const body = await readJson(req);
        const targetUrl = String(body.url || body.jobUrl || "").trim();
        if (!targetUrl) {
          return sendJson(res, 400, { ok: false, error: "url or jobUrl is required" });
        }
        const result = await fetchJobPageWithPlaywright({ jobUrl: targetUrl });
        return sendJson(res, 200, result);
      }

      return sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      return sendJson(res, 500, {
        ok: false,
        error: error.message,
        name: error.name
      });
    }
  });
}

function startJdFetcherServer({
  port = Number(process.env.PORT || process.env.JD_FETCHER_PORT || DEFAULT_PORT),
  host = String(process.env.HOST || DEFAULT_HOST)
} = {}) {
  const server = createJdFetcherServer();
  server.listen(port, host, () => {
    console.log(`JD fetcher listening at http://${host}:${port}`);
  });
  return server;
}

if (require.main === module) {
  startJdFetcherServer();
}

module.exports = {
  createJdFetcherServer,
  startJdFetcherServer
};
