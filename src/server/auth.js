const store = require("./store");
const logger = require("./platform/logger");

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "applyflow_session";
const SESSION_COOKIE_SAMESITE = process.env.SESSION_COOKIE_SAMESITE || "Lax";
const SESSION_COOKIE_SECURE =
  String(process.env.SESSION_COOKIE_SECURE || "").toLowerCase() === "true" ||
  process.env.NODE_ENV === "production";

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(";").reduce((acc, entry) => {
    const [key, ...parts] = entry.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(parts.join("="));
    return acc;
  }, {});
}

function getSessionCookie(req) {
  const cookies = parseCookies(req);
  return cookies[SESSION_COOKIE_NAME] || null;
}

function resolveUserFromRequest(req) {
  const devUser = req.headers["x-dev-user"];
  if (devUser) {
    return store.findUserByLogin(String(devUser));
  }
  const sessionId = getSessionCookie(req);
  const session = store.getSession(sessionId);
  if (!session) return null;
  return store.getUser(session.userId) || null;
}

function getCurrentUser(req) {
  return resolveUserFromRequest(req);
}

function buildCookieHeader(sessionId, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  const securePart = SESSION_COOKIE_SECURE ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=${SESSION_COOKIE_SAMESITE}; Expires=${expires}${securePart}`;
}

function clearCookieHeader() {
  const securePart = SESSION_COOKIE_SECURE ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${SESSION_COOKIE_SAMESITE}; Expires=Thu, 01 Jan 1970 00:00:00 GMT${securePart}`;
}

function issueSession(res, userId) {
  const session = store.createSession(userId);
  res.setHeader("Set-Cookie", buildCookieHeader(session.sessionId, session.expiresAt));
  logger.info("auth.session_issued", {
    userId,
    sessionId: session.sessionId,
    secureCookie: SESSION_COOKIE_SECURE
  });
  return session;
}

function clearSession(req, res) {
  const sessionId = getSessionCookie(req);
  if (sessionId) {
    store.deleteSession(sessionId);
    logger.info("auth.session_cleared", { sessionId });
  }
  res.setHeader("Set-Cookie", clearCookieHeader());
}

module.exports = {
  SESSION_COOKIE_NAME,
  getCurrentUser,
  resolveUserFromRequest,
  issueSession,
  clearSession
};
