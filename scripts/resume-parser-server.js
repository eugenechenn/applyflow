const { createServer } = require("http");
const { parseResumeDocument } = require('../src/lib/resume/resume-parser.js');

const DEFAULT_PORT = 4234;
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

function createResumeParserServer() {
  return createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return sendJson(res, 200, { ok: true, service: "resume-parser" });
      }

      if (req.method === "POST" && req.url === "/parse-resume") {
        const body = await readJson(req);
        if (!body.fileName || !body.mimeType || !body.base64Data) {
          return sendJson(res, 400, {
            ok: false,
            error: "fileName、mimeType、base64Data 为必填项。"
          });
        }

        const parsed = await parseResumeDocument(body);
        return sendJson(res, 200, { ok: true, data: parsed });
      }

      return sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      console.error("resume-parser-server error", error);
      return sendJson(res, 500, {
        ok: false,
        error: error.code === "RESUME_FILE_TOO_LARGE" ? error.message : "简历解析服务处理失败。",
        code: error.code || "RESUME_PARSER_INTERNAL_ERROR"
      });
    }
  });
}

function startResumeParserServer({
  port = Number(process.env.PORT || process.env.RESUME_PARSER_PORT || DEFAULT_PORT),
  host = String(process.env.HOST || DEFAULT_HOST)
} = {}) {
  const server = createResumeParserServer();
  server.listen(port, host, () => {
    console.log(`[resume-parser] listening on http://${host}:${port}`);
    console.log(`[resume-parser] health endpoint: http://${host}:${port}/health`);
    console.log(`[resume-parser] parse endpoint: http://${host}:${port}/parse-resume`);
  });
  return server;
}

if (require.main === module) {
  startResumeParserServer();
}

module.exports = {
  createResumeParserServer,
  startResumeParserServer
};
