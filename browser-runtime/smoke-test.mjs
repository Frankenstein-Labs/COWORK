import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = (
  process.env.BROWSER_RUNTIME_URL || "http://127.0.0.1:10000"
).replace(/\/$/, "");
const token = process.env.BROWSER_RUNTIME_API_KEY;
const secondTenantToken = process.env.BROWSER_RUNTIME_SECOND_API_KEY;
const allowedOrigin =
  process.env.BROWSER_RUNTIME_TEST_ORIGIN ||
  "https://cowork-chi-seven.vercel.app";

if (!token) {
  console.error("Set BROWSER_RUNTIME_API_KEY before running the smoke test.");
  process.exit(2);
}

const sessionId = `smoke-${randomUUID()}`;
const isolatedSessionId = `smoke-isolated-${randomUUID()}`;
const sharedSessionId = `smoke-shared-${randomUUID()}`;

async function request(
  path,
  { method = "GET", body, authToken = token, headers = {} } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return { response, payload };
}

async function post(session, action, body = {}) {
  const { response, payload } = await request(
    `/api/sessions/${session}/${action}`,
    { method: "POST", body },
  );
  assert.equal(
    response.status,
    200,
    `${action} returned ${response.status}: ${JSON.stringify(payload)}`,
  );
  return payload;
}

async function content(session, authToken = token) {
  const { response, payload } = await request(
    `/api/sessions/${session}/content`,
    { authToken },
  );
  assert.equal(
    response.status,
    200,
    `content returned ${response.status}: ${JSON.stringify(payload)}`,
  );
  return payload;
}

async function waitForContent(session, predicate, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await content(session);
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out waiting for page content. Last response: ${JSON.stringify(last)}`,
  );
}

async function mcpPost(payload) {
  const { response, payload: result } = await request("/mcp", {
    method: "POST",
    body: payload,
    headers: {
      Accept: "application/json, text/event-stream",
      "Mcp-Protocol-Version": "2025-03-26",
    },
  });
  assert.equal(
    response.status,
    200,
    `MCP returned ${response.status}: ${JSON.stringify(result)}`,
  );
  return result;
}

console.log(`Smoke-testing ${baseUrl}`);

const health = await fetch(`${baseUrl}/healthz`);
assert.equal(health.status, 200, "healthz must be public and healthy");
assert.equal((await health.json()).runtime, "chromium-playwright");

const unauth = await request(`/api/sessions/${sessionId}/state`, {
  authToken: null,
});
assert.equal(
  unauth.response.status,
  401,
  "API must reject requests without a bearer token",
);

const preflight = await fetch(`${baseUrl}/api/sessions/${sessionId}/navigate`, {
  method: "OPTIONS",
  headers: {
    Origin: allowedOrigin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization,content-type",
  },
});
assert.equal(
  preflight.status,
  204,
  "CORS preflight must succeed for the configured Vercel origin",
);
assert.equal(
  preflight.headers.get("access-control-allow-origin"),
  allowedOrigin,
);
const deniedOrigin = await fetch(
  `${baseUrl}/api/sessions/${sessionId}/navigate`,
  {
    method: "OPTIONS",
    headers: {
      Origin: "https://not-cortex.example",
      "Access-Control-Request-Method": "POST",
    },
  },
);
assert.equal(
  deniedOrigin.headers.get("access-control-allow-origin"),
  null,
  "CORS must reject an unrelated origin",
);

const initial = await request(`/api/sessions/${sessionId}/state`);
assert.equal(initial.response.status, 200);
assert.equal(initial.payload.tabs.length, 1);
assert.equal(initial.payload.tabs[0].url, "about:blank");

const privateAddress = await request(`/api/sessions/${sessionId}/navigate`, {
  method: "POST",
  body: { url: "http://127.0.0.1:10000/healthz" },
});
assert.equal(
  privateAddress.response.status,
  400,
  "navigation to loopback must be blocked",
);
assert.match(privateAddress.payload.error, /private|local/i);

await post(sessionId, "navigate", { url: "https://httpbin.org/forms/post" });
let page = await content(sessionId);
assert.equal(page.url, "https://httpbin.org/forms/post");
assert.match(page.text, /Customer name/);
assert.match(page.ariaSnapshot, /textbox "Customer name/);

const screenshot = await request(`/api/sessions/${sessionId}/screenshot`);
assert.equal(screenshot.response.status, 200);
assert.match(
  screenshot.response.headers.get("content-type") || "",
  /image\/jpeg/,
);
assert.ok(
  screenshot.payload.length > 5_000,
  "real Chromium screenshot should contain page pixels",
);
assert.equal(screenshot.payload[0], 0xff);
assert.equal(screenshot.payload[1], 0xd8);

// httpbin's fixed 1365×900 form gives the same target positions used by the visible Browser viewport.
await post(sessionId, "click", { x: 210, y: 26 });
await post(sessionId, "type", { text: "CORTEX Playwright Smoke Test" });
await post(sessionId, "click", { x: 34, y: 443 });
await post(sessionId, "click", { x: 55, y: 605 });
page = await waitForContent(
  sessionId,
  (value) =>
    value.url === "https://httpbin.org/post" &&
    value.text.includes("CORTEX Playwright Smoke Test"),
);
assert.match(page.text, /"custname": "CORTEX Playwright Smoke Test"/);
assert.match(page.text, /"topping": "mushroom"/);

await post(sessionId, "navigate", { url: "https://example.com" });
await post(sessionId, "back");
page = await content(sessionId);
assert.equal(
  page.url,
  "https://httpbin.org/post",
  "back must restore the previous page",
);
await post(sessionId, "forward");
page = await content(sessionId);
assert.equal(
  page.url,
  "https://example.com/",
  "forward must restore the next page",
);
await post(sessionId, "reload");
assert.equal((await content(sessionId)).title, "Example Domain");

const originalTabId = (await request(`/api/sessions/${sessionId}/state`))
  .payload.activeTabId;
const newTab = await post(sessionId, "tabs", { url: "https://example.net" });
assert.equal(
  newTab.tabs.length,
  2,
  "new tab must be created in the same session",
);
assert.equal(newTab.tabs.find((tab) => tab.active).url, "https://example.net/");
const newTabId = newTab.openedTabId;
await request(`/api/sessions/${sessionId}/tabs/${originalTabId}/activate`, {
  method: "POST",
  body: {},
});
assert.equal((await content(sessionId)).url, "https://example.com/");
const closed = await request(`/api/sessions/${sessionId}/tabs/${newTabId}`, {
  method: "DELETE",
  body: {},
});
assert.equal(closed.response.status, 200);
assert.equal(closed.payload.tabs.length, 1);

const isolated = await request(`/api/sessions/${isolatedSessionId}/state`);
assert.equal(isolated.response.status, 200);
assert.equal(
  isolated.payload.tabs[0].url,
  "about:blank",
  "another session must start with independent state",
);
assert.equal((await content(sessionId)).url, "https://example.com/");

if (secondTenantToken) {
  await post(sharedSessionId, "navigate", { url: "https://example.net" });
  const otherTenant = await request(`/api/sessions/${sharedSessionId}/state`, {
    authToken: secondTenantToken,
  });
  assert.equal(otherTenant.response.status, 200);
  assert.equal(
    otherTenant.payload.tabs[0].url,
    "about:blank",
    "tenant B must not see tenant A's session",
  );
  console.log("Tenant separation: passed");
} else {
  console.warn(
    "Tenant separation test skipped; set BROWSER_RUNTIME_SECOND_API_KEY to a token mapped to another tenant.",
  );
}

const initialize = await mcpPost({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "cortex-browser-smoke", version: "0.1.0" },
  },
});
assert.equal(initialize.result.serverInfo.name, "cortex-browser-runtime");
const tools = await mcpPost({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {},
});
const toolNames = tools.result.tools.map((tool) => tool.name);
assert.ok(toolNames.includes("browser_navigate"));
assert.ok(toolNames.includes("browser_click"));
assert.ok(toolNames.includes("browser_type"));
assert.ok(toolNames.includes("browser_screenshot"));
const call = await mcpPost({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: {
    name: "browser_navigate",
    arguments: { session_id: sessionId, url: "https://example.net" },
  },
});
assert.ok(
  call.result && !call.result.isError,
  "MCP browser_navigate must succeed",
);
assert.match(call.result.content[0].text, /example\.net/);
assert.equal((await content(sessionId)).url, "https://example.net/");

console.log(
  "PASS: real Chromium navigation, history, tabs, screenshot, click, typing, session isolation, CORS, SSRF guard, and MCP tools.",
);
