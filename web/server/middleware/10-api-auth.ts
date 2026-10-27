import { authenticate, authenticateAgent, bearerToken } from "../utils/auth";

// S1: authoritative authentication gate for every route. Correct regardless of
// whether it runs before or after the basic-auth module:
// - Public: POST /api/enroll/request, GET /api/enroll/:code (rate-limited inside).
// - WS handshakes pass through to the `upgrade` hook in api/ws.ts, which
//   consumes the ticket. Plain HTTP on /api/ws is denied.
// - POST /api/metrics, POST /api/ws-ticket: operator Basic OR enrolled-agent Bearer.
// - Everything else (API and pages): operator Basic only.
const AGENT_AND_OPERATOR: Record<string, string[]> = {
  "/api/metrics": ["POST"],
  "/api/ws-ticket": ["POST"],
};

if (!process.env.NUXT_BASIC_AUTH_USERS?.trim()) {
  console.error(
    "[auth] NUXT_BASIC_AUTH_USERS is not set: all operator routes will deny every request. " +
      "Configure at least one operator user."
  );
}

function deny(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]): never {
  setHeader(event, "WWW-Authenticate", 'Basic realm="Secure Area", charset="UTF-8"');
  throw createError({ statusCode: 401, statusMessage: "Authentication required" });
}


function forbidden(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]): never {
  throw createError({ statusCode: 403, statusMessage: "Forbidden" });
}

// CSRF gate for browser-ambient operator credentials (cached Basic auth).
// - When the browser sends Origin, it must match this host. Page scripts
//   cannot forge Origin, so a match proves a same-origin initiator.
// - Otherwise, operator POSTs must use application/json. Plain HTML forms
//   can only send urlencoded/multipart/text bodies, and cross-origin
//   fetch/XHR with a JSON body is stopped by CORS preflight (this server
//   sends no CORS headers). PUT/PATCH/DELETE are unreachable cross-origin
//   without a preflight, so the method itself is the signal there.
// Non-browser clients (curl, scripts, tests) send neither Origin nor
// Referer and pass with a JSON body on POST.
function checkCsrf(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]): void {
  const origin = getHeader(event, "origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      forbidden(event);
    }
    const host = (getHeader(event, "host") ?? getHeader(event, "x-forwarded-host") ?? "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    if (!host || (originHost!).toLowerCase() !== host) forbidden(event);
    return;
  }
  if (event.method === "POST") {
    const contentType = (getHeader(event, "content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") forbidden(event);
  }
}

export default defineEventHandler(async (event) => {
  const pathname = event.path.split("?", 1)[0];

  if (pathname === "/api/enroll/request" && event.method === "POST") return;
  if (event.method === "GET" && /^\/api\/enroll\/[0-9A-F]{12}$/.test(pathname)) return;

  if (pathname === "/api/ws") {
    // Real handshakes carry Upgrade: websocket and are decided by the upgrade
    // hook (ticket auth); anything else on this path is denied.
    if ((getHeader(event, "upgrade") ?? "").toLowerCase() === "websocket") return;
    deny(event);
  }

  const allowedMethods = AGENT_AND_OPERATOR[pathname];
  if (allowedMethods?.includes(event.method)) {
    if (authenticate(event)) {
      checkCsrf(event);
      return;
    }
    if (await authenticateAgent(bearerToken(getHeader(event, "authorization")))) return;
    deny(event);
  }

  if (authenticate(event)) {
    if (event.method !== "GET" && event.method !== "HEAD") checkCsrf(event);
    return;
  }
  deny(event);
});
