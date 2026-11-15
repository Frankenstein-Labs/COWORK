import http from "node:http";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 10000);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SESSIONS_PER_TENANT = 4;
const MAX_TOTAL_SESSIONS = 8;
const MAX_TABS_PER_SESSION = 6;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const VIEWPORT = { width: 1365, height: 900 };
const tenantByToken = readApiKeys();
const sessions = new Map();
const pendingSessionCreations = new Map();
let browser;

function readApiKeys() {
  let entries = {};
  if (process.env.BROWSER_RUNTIME_API_KEYS) {
    try {
      entries = JSON.parse(process.env.BROWSER_RUNTIME_API_KEYS);
    } catch {
      throw new Error("BROWSER_RUNTIME_API_KEYS must be a JSON object");
    }
  } else if (process.env.BROWSER_RUNTIME_API_KEY) {
    entries = { [process.env.BROWSER_RUNTIME_API_KEY]: "cortex-owner" };
  }
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error("BROWSER_RUNTIME_API_KEYS must map tokens to tenant identifiers");
  }
  const result = new Map();
  for (const [token, tenant] of Object.entries(entries)) {
    if (token.length < 32 || typeof tenant !== "string" || !tenant.trim()) {
      throw new Error("Each browser token must be at least 32 characters and map to a tenant identifier");
    }
    result.set(token, tenant.trim());
  }
  if (result.size === 0) {
    throw new Error("Set BROWSER_RUNTIME_API_KEYS before starting the browser runtime");
  }
  return result;
}

function isPrivateIp(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      return isPrivateIp(normalized.slice(7));
    }
    return (
      normalized === "::" || normalized === "::1" ||
      normalized.startsWith("fc") || normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) || normalized.startsWith("ff")
    );
  }
  return true;
}

async function assertPublicHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid web address");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS pages are allowed");
  }
  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local and private network addresses are blocked");
  }
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Local and private network addresses are blocked");
  }
  return url;
}

function sessionKey(tenant, sessionId) {
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(sessionId)) {
    throw new Error("Invalid session_id");
  }
  return `${tenant}:${sessionId}`;
}

function authorize(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) return null;
  return tenantByToken.get(match[1]) || null;
}

function setCors(req, res) {
  const origin = req.headers.origin;
  const configured = (process.env.BROWSER_RUNTIME_ALLOWED_ORIGINS || "*")
    .split(",").map((value) => value.trim()).filter(Boolean);
  if (origin && (configured.includes("*") || configured.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", configured.includes("*") ? "*" : origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,Mcp-Session-Id,Mcp-Protocol-Version");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id,Mcp-Protocol-Version");
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function ensureSession(tenant, sessionId) {
  const key = sessionKey(tenant, sessionId);
  const pending = pendingSessionCreations.get(key);
  if (pending) return pending;
  const session = sessions.get(key);
  if (session) {
    session.lastUsed = Date.now();
    return session;
  }
  const tenantCount = [...sessions.values()].filter((item) => item.tenant === tenant).length;
  const tenantPendingCount = [...pendingSessionCreations.keys()].filter((pendingKey) => pendingKey.startsWith(`${tenant}:`)).length;
  if (
    tenantCount + tenantPendingCount >= MAX_SESSIONS_PER_TENANT ||
    sessions.size + pendingSessionCreations.size >= MAX_TOTAL_SESSIONS
  ) {
    throw new Error("This tenant has reached the active browser-session limit");
  }
  const creation = (async () => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    await context.routeWebSocket("**/*", async (route) => {
      try {
        const webSocketUrl = route.url();
        const checkedUrl = webSocketUrl.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
        await assertPublicHttpUrl(checkedUrl);
        await route.connectToServer();
      } catch {
        await route.close();
      }
    });
    const created = { tenant, sessionId, key, context, pages: new Map(), activeTabId: "", lastUsed: Date.now(), lock: Promise.resolve() };
    sessions.set(key, created);
    try {
      await createTab(created);
      return created;
    } catch (error) {
      sessions.delete(key);
      await context.close().catch(() => {});
      throw error;
    }
  })();
  pendingSessionCreations.set(key, creation);
  try {
    return await creation;
  } finally {
    pendingSessionCreations.delete(key);
  }
}

async function attachNetworkGuard(page) {
  await page.route("**/*", async (route) => {
    try {
      const requestUrl = route.request().url();
      if (requestUrl === "about:blank" || requestUrl.startsWith("data:")) {
        await route.continue();
        return;
      }
      await assertPublicHttpUrl(requestUrl);
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
}

async function createTab(session, initialUrl = "about:blank") {
  if (session.pages.size >= MAX_TABS_PER_SESSION) throw new Error("This browser session has reached the tab limit");
  const page = await session.context.newPage();
  await attachNetworkGuard(page);
  const id = randomBytes(8).toString("hex");
  session.pages.set(id, page);
  session.activeTabId = id;
  if (initialUrl !== "about:blank") {
    const url = await assertPublicHttpUrl(initialUrl);
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30000 });
  }
  session.lastUsed = Date.now();
  return { id, page };
}

function activePage(session) {
  const page = session.pages.get(session.activeTabId);
  if (!page || page.isClosed()) throw new Error("No active browser tab");
  return page;
}

async function pageState(session) {
  const tabs = await Promise.all([...session.pages.entries()].map(async ([id, page]) => ({
    id,
    url: page.isClosed() ? "" : page.url(),
    title: page.isClosed() ? "" : await page.title().catch(() => ""),
    active: id === session.activeTabId,
  })));
  return { sessionId: session.sessionId, tabs, activeTabId: session.activeTabId };
}

async function perform(tenant, sessionId, action, payload = {}) {
  const session = await ensureSession(tenant, sessionId);
  const operation = session.lock.then(() => performUnlocked(session, action, payload));
  session.lock = operation.then(() => undefined, () => undefined);
  return operation;
}

async function performUnlocked(session, action, payload = {}) {
  const page = activePage(session);
  let result;
  switch (action) {
    case "state":
      result = await pageState(session);
      break;
    case "navigate": {
      const url = await assertPublicHttpUrl(payload.url);
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30000 });
      result = await pageState(session);
      break;
    }
    case "back":
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
      result = await pageState(session);
      break;
    case "forward":
      await page.goForward({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
      result = await pageState(session);
      break;
    case "reload":
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      result = await pageState(session);
      break;
    case "new-tab": {
      const tab = await createTab(session, payload.url || "about:blank");
      result = { ...(await pageState(session)), openedTabId: tab.id };
      break;
    }
    case "switch-tab":
      if (!session.pages.has(payload.tabId)) throw new Error("Unknown browser tab");
      session.activeTabId = payload.tabId;
      result = await pageState(session);
      break;
    case "close-tab": {
      const tabId = payload.tabId || session.activeTabId;
      const tab = session.pages.get(tabId);
      if (!tab) throw new Error("Unknown browser tab");
      await tab.close();
      session.pages.delete(tabId);
      if (!session.pages.size) await createTab(session);
      else if (session.activeTabId === tabId) session.activeTabId = session.pages.keys().next().value;
      result = await pageState(session);
      break;
    }
    case "click": {
      const x = Number(payload.x);
      const y = Number(payload.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > VIEWPORT.width || y > VIEWPORT.height) {
        throw new Error("Pointer coordinates are outside the browser viewport");
      }
      await page.mouse.click(x, y);
      result = await pageState(session);
      break;
    }
    case "type":
      if (typeof payload.text !== "string" || payload.text.length > 2000) throw new Error("Text must be 1–2000 characters");
      await page.keyboard.insertText(payload.text);
      result = await pageState(session);
      break;
    case "press":
      if (typeof payload.key !== "string" || !/^[A-Za-z0-9+\-_]{1,40}$/.test(payload.key)) throw new Error("Invalid key name");
      await page.keyboard.press(payload.key);
      result = await pageState(session);
      break;
    case "content":
      result = { url: page.url(), title: await page.title().catch(() => ""), text: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 40000), ariaSnapshot: (await page.locator("body").ariaSnapshot().catch(() => "")).slice(0, 40000) };
      break;
    case "screenshot":
      result = await page.screenshot({ type: "jpeg", quality: 78, animations: "disabled", timeout: 10000 });
      break;
    default:
      throw new Error("Unknown browser action");
  }
  session.lastUsed = Date.now();
  return result;
}

function registerMcpTools(server, tenant) {
  const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
  const imageResult = async (sessionId) => {
    const image = await perform(tenant, sessionId, "screenshot");
    return { content: [{ type: "image", data: image.toString("base64"), mimeType: "image/jpeg" }] };
  };
  server.tool("browser_navigate", "Navigate the shared conversation Chromium session to a public HTTP(S) page.", { session_id: id, url: z.string().url() }, async ({ session_id, url }) => {
    const state = await perform(tenant, session_id, "navigate", { url });
    return { content: [{ type: "text", text: JSON.stringify(state) }] };
  });
  server.tool("browser_back", "Go back in the shared browser session.", { session_id: id }, async ({ session_id }) => ({ content: [{ type: "text", text: JSON.stringify(await perform(tenant, session_id, "back")) }] }));
  server.tool("browser_forward", "Go forward in the shared browser session.", { session_id: id }, async ({ session_id }) => ({ content: [{ type: "text", text: JSON.stringify(await perform(tenant, session_id, "forward")) }] }));
  server.tool("browser_reload", "Reload the active tab in the shared browser session.", { session_id: id }, async ({ session_id }) => ({ content: [{ type: "text", text: JSON.stringify(await perform(tenant, session_id, "reload")) }] }));
  server.tool("browser_new_tab", "Open a new tab in the shared browser session.", { session_id: id, url: z.string().url().optional() }, async ({ session_id, url }) => ({ content: [{ type: "text", text: JSON.stringify(await perform(tenant, session_id, "new-tab", { url })) }] }));
  server.tool("browser_switch_tab", "Select a tab in the shared browser session.", { session_id: id, tab_id: z.string().min(1).max(32) }, async ({ session_id, tab_id }) => ({ content: [{ type: "text", text: JSON.stringify(await perform(tenant, session_id, "switch-tab", { tabId: tab_id })) }] }));
  server.tool("browser_close_tab", "Close a tab in the shared browser session.", { session_id: id, tab_id: z.string().min(1).max(32).optional() }, async ({ session_id, tab_id }) => ({ content: [{ type: "text", text: JSON.stringify(await perform(tenant, session_id, "close-tab", { tabId: tab_id })) }] }));
  server.tool("browser_click", "Click at viewport coordinates in the shared browser session.", { session_id: id, x: z.number(), y: z.number() }, async ({ session_id, x, y }) => ({ content: [{ type: "text", text: JSON.stringify(await perform(tenant, session_id, "click", { x, y })) }] }));
  server.tool("browser_type", "Type text into the focused element in the shared browser session.", { session_id: id, text: z.string().min(1).max(2000) }, async ({ session_id, text }) => ({ content: [{ type: "text", text: JSON.stringify(await perform(tenant, session_id, "type", { text })) }] }));
  server.tool("browser_press", "Press a keyboard key in the shared browser session.", { session_id: id, key: z.string().min(1).max(40) }, async ({ session_id, key }) => ({ content: [{ type: "text", text: JSON.stringify(await perform(tenant, session_id, "press", { key })) }] }));
  server.tool("browser_read_page", "Read page title, URL, visible text, and accessibility snapshot from the shared browser session.", { session_id: id }, async ({ session_id }) => ({ content: [{ type: "text", text: JSON.stringify(await perform(tenant, session_id, "content")) }] }));
  server.tool("browser_screenshot", "Capture the current real Chromium page in the shared browser session.", { session_id: id }, imageResult);
}

async function handleMcp(req, res, tenant) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "MCP uses POST" });
    return;
  }
  const body = await readJson(req);
  const server = new McpServer({ name: "cortex-browser-runtime", version: "0.1.0" });
  registerMcpTools(server, tenant);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function handle(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/healthz" && req.method === "GET") {
    sendJson(res, 200, { ok: true, runtime: "chromium-playwright", activeSessions: sessions.size });
    return;
  }
  const tenant = authorize(req);
  if (!tenant) {
    sendJson(res, 401, { error: "A valid browser runtime bearer token is required" });
    return;
  }
  if (url.pathname === "/mcp") {
    await handleMcp(req, res, tenant);
    return;
  }
  const match = /^\/api\/sessions\/([A-Za-z0-9._:-]{1,128})(?:\/(.*))?$/.exec(url.pathname);
  if (!match) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  const [, sessionId, suffix = ""] = match;
  try {
    if (req.method === "GET" && suffix === "state") {
      sendJson(res, 200, await perform(tenant, sessionId, "state"));
      return;
    }
    if (req.method === "GET" && suffix === "screenshot") {
      const image = await perform(tenant, sessionId, "screenshot");
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
      res.end(image);
      return;
    }
    if (req.method === "GET" && suffix === "content") {
      sendJson(res, 200, await perform(tenant, sessionId, "content"));
      return;
    }
    const body = ["POST", "DELETE"].includes(req.method) ? await readJson(req) : {};
    const actions = new Map([
      ["navigate", "navigate"], ["back", "back"], ["forward", "forward"], ["reload", "reload"],
      ["tabs", "new-tab"], ["click", "click"], ["type", "type"], ["press", "press"],
    ]);
    if (req.method === "POST" && actions.has(suffix)) {
      const result = await perform(tenant, sessionId, actions.get(suffix), body);
      sendJson(res, 200, result);
      return;
    }
    const switchMatch = /^tabs\/([A-Za-z0-9]+)\/activate$/.exec(suffix);
    if (req.method === "POST" && switchMatch) {
      sendJson(res, 200, await perform(tenant, sessionId, "switch-tab", { tabId: switchMatch[1] }));
      return;
    }
    const closeMatch = /^tabs\/([A-Za-z0-9]+)$/.exec(suffix);
    if (req.method === "DELETE" && closeMatch) {
      sendJson(res, 200, await perform(tenant, sessionId, "close-tab", { tabId: closeMatch[1] }));
      return;
    }
    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Browser operation failed" });
  }
}

const server = http.createServer((req, res) => {
  void handle(req, res).catch((error) => {
    if (!res.headersSent) sendJson(res, 500, { error: "Browser runtime error" });
    else res.destroy(error);
  });
});

server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.lastUsed > SESSION_IDLE_MS) {
      sessions.delete(key);
      void session.context.close().catch(() => {});
    }
  }
}, 60_000);
cleanupTimer.unref();

async function shutdown(signal) {
  clearInterval(cleanupTimer);
  server.close();
  await Promise.all([...sessions.values()].map((session) => session.context.close().catch(() => {})));
  sessions.clear();
  await browser?.close().catch(() => {});
  process.exit(signal ? 0 : 1);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

const chromiumLaunchOptions = { headless: true, args: ["--disable-dev-shm-usage"] };
if (process.env.BROWSER_EXECUTABLE_PATH) {
  chromiumLaunchOptions.executablePath = process.env.BROWSER_EXECUTABLE_PATH;
}
browser = await chromium.launch(chromiumLaunchOptions);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`CORTEX browser runtime listening on ${PORT}; Chromium ${browser.version()}`);
});
