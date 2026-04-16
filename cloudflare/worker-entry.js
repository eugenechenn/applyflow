import apiRoutesModule from "../src/server/routes/api.js";
import requestContextModule from "../src/server/request-context.js";
import authModule from "../src/server/auth.js";
import loggerModule from "../src/server/platform/logger.js";
import d1RuntimeStoreModule from "../src/server/db/d1-runtime-store.js";

const { handleApiRequest } = apiRoutesModule;
const { runWithRequestContext } = requestContextModule;
const { SESSION_COOKIE_NAME } = authModule;
const logger = loggerModule;
const { createWorkerOverrideStore } = d1RuntimeStoreModule;

function createDebugErrorResponse({ error, env, request, pathname }) {
  const stackPreview = String(error?.stack || "")
    .split("\n")
    .slice(0, 6);
  const bindingName = env?.CLOUDFLARE_D1_BINDING || "APPLYFLOW_DB";
  const dbBinding = env?.[bindingName] || env?.APPLYFLOW_DB || env?.DB || null;

  return new Response(
    JSON.stringify(
      {
        success: false,
        error: {
          code: "DEBUG_ROUTE_ERROR",
          message: error?.message || "Unknown worker error.",
          name: error?.name || "Error",
          stackPreview,
          request: {
            method: request.method,
            path: pathname
          },
          runtime: {
            hasApplyflowDbBinding: Boolean(env?.APPLYFLOW_DB),
            hasDbBinding: Boolean(env?.DB),
            configuredD1BindingName: bindingName,
            hasConfiguredD1Binding: Boolean(dbBinding),
            hasSessionSecret: Boolean(env?.SESSION_SECRET)
          }
        }
      },
      null,
      2
    ),
    {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" }
    }
  );
}

class FetchRequestShim {
  constructor(request) {
    this.method = request.method;
    this.url = request.url;
    this.rawRequest = request;
    this.headers = {};
    request.headers.forEach((value, key) => {
      this.headers[key.toLowerCase()] = value;
    });
  }

  async *[Symbol.asyncIterator]() {
    const buffer = await this.rawRequest.arrayBuffer();
    if (buffer.byteLength > 0) {
      yield Buffer.from(buffer);
    }
  }
}

class FetchResponseShim {
  constructor() {
    this.statusCode = 200;
    this.headers = new Headers();
    this.body = "";
    this.finished = false;
    this.finishListeners = [];
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    Object.entries(headers).forEach(([key, value]) => {
      this.headers.set(key, value);
    });
  }

  setHeader(key, value) {
    if (Array.isArray(value)) {
      value.forEach((entry) => this.headers.append(key, entry));
      return;
    }
    if (key.toLowerCase() === "set-cookie") {
      this.headers.append(key, value);
      return;
    }
    this.headers.set(key, value);
  }

  on(event, listener) {
    if (event === "finish") {
      this.finishListeners.push(listener);
    }
  }

  end(body = "") {
    this.body = body;
    this.finished = true;
    this.finishListeners.forEach((listener) => listener());
  }

  toResponse() {
    return new Response(this.body, {
      status: this.statusCode,
      headers: this.headers
    });
  }
}

async function handleApiFetch(request, env) {
  const requestUrl = new URL(request.url);
  const pathname = requestUrl.pathname;
  try {
    const workerState = await createWorkerOverrideStore({ env, request });
    const reqShim = new FetchRequestShim(request);
    const resShim = new FetchResponseShim();

    const currentUser =
      workerState.currentSession?.userId ? workerState.users.find((user) => user.id === workerState.currentSession.userId) : null;

    const handled = await runWithRequestContext(
      {
        userId: currentUser?.id || null,
        overrideStore: workerState.overrideStore,
        env,
        pathname,
        method: request.method
      },
      () => handleApiRequest(reqShim, resShim, pathname)
    );

    if (handled === false) {
      resShim.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      resShim.end(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "API route not found." } }));
    }

    await workerState.overrideStore.flush();
    return resShim.toResponse();
  } catch (error) {
    if (pathname === "/api/login" || pathname === "/api/auth/session") {
      return createDebugErrorResponse({ error, env, request, pathname });
    }
    throw error;
  }
}

async function handleAssetFetch(request, env) {
  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) {
    return assetResponse;
  }

  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return new Response("Not found", { status: 404 });
  }

  return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
}

export default {
  async fetch(request, env, ctx) {
    const startedAt = Date.now();
    const pathname = new URL(request.url).pathname;

    try {
      if (pathname.startsWith("/api/")) {
        const response = await handleApiFetch(request, env, ctx);
        logger.info("worker.request", {
          pathname,
          method: request.method,
          statusCode: response.status,
          durationMs: Date.now() - startedAt,
          runtime: "cloudflare"
        });
        return response;
      }

      const response = await handleAssetFetch(request, env, ctx);
      logger.info("worker.asset_request", {
        pathname,
        method: request.method,
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
        runtime: "cloudflare"
      });
      return response;
    } catch (error) {
      logger.error("worker.error", {
        pathname,
        method: request.method,
        message: error.message
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "WORKER_RUNTIME_ERROR",
            message: "The Cloudflare worker failed to process the request."
          }
        }),
        {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8" }
        }
      );
    }
  }
};
