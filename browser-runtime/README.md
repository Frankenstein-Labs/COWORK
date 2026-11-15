# CORTEX Browser Runtime

This directory contains the separate Render service that owns the real Chromium process. The Vercel frontend remains a client of this service; it does not attempt to run Chromium in the browser or in a Vercel function.

## Runtime and isolation

The service uses the official Playwright container image and starts Chromium through Playwright. Each `(tenant, session_id)` receives its own in-memory `BrowserContext`, so cookies, local storage, and tabs are separate between tenants and conversations. Contexts are ephemeral: a Render restart or deploy discards them. Persistent profiles are intentionally disabled until encrypted, tenant-scoped storage is configured.

The API exposes navigation, back/forward/reload, multiple tabs, visible page text, screenshots, pointer/keyboard input, and a Streamable HTTP MCP endpoint at `/mcp`. The MCP endpoint is a custom authenticated, session-aware facade built with the official MCP SDK and Playwright. It is not an unmodified `@playwright/mcp` server: the stock package documents that it is not a security boundary, while this service needs bearer authentication and an explicit per-conversation `session_id`.

Local OpenHands launches pass the current conversation ID as the MCP `session_id`, allowing the agent to address the Chromium context shown by the Browser tab. Cloud and ACP launch paths do not yet receive this session binding.

## Deploying on Render

Create a Docker web service from the repository root and set the Dockerfile path to `browser-runtime/Dockerfile`. The service listens on Render's `PORT` and serves a public HTTPS endpoint. Configure health checks at `/healthz`.

Required environment variable:

- `BROWSER_RUNTIME_API_KEYS`: JSON object mapping bearer tokens to tenant identifiers, for example `{"<random-token-of-at-least-32-characters>":"cortex-owner"}`. Store real values only as Render secrets. Use a distinct high-entropy token and tenant ID per authorized user; never put a token in Git or a `VITE_*` variable.

Optional:

- `BROWSER_RUNTIME_ALLOWED_ORIGINS`: comma-separated list of exact trusted frontend origins, e.g. `https://your-app.vercel.app`. The default `*` is convenient for testing, not recommended for production. CORS is not an authorization boundary.
- `PORT`: supplied by Render.

The service refuses to start without a valid key map. Session IDs are additionally scoped to the authenticated tenant. Keep the token used by the Browser tab and the matching MCP server configuration identical for each user.

## Connecting CORTEX.Cowork

1. In the Browser tab, enter the Render service base URL (without `/mcp`) and the user's bearer token. The frontend stores the base URL in local storage and the token only in that browser tab's session storage.
2. To let the agent use the same browser, open CORTEX.Cowork's MCP settings (`/mcp`) and add a remote Streamable HTTP server with URL `https://<render-host>/mcp` and Bearer authentication using the same user's token.
3. Select that MCP server in the intended OpenHands agent profile (`mcp_server_refs`). Local OpenHands conversations then receive their own conversation ID as `session_id`; the MCP server and Browser tab target the same session.

MCP server configuration is shared across profiles in a CORTEX.Cowork account, while `mcp_server_refs` selects which profiles may use it. ACP and Cloud session-ID injection require additional lifecycle/contract work before they can share the visible tab automatically.

## Local run and checks

```sh
cd browser-runtime
npm ci
BROWSER_RUNTIME_API_KEYS='{"0123456789abcdef0123456789abcdef":"local-dev"}' npm start
```

Health check: `GET /healthz`. The service accepts only HTTP(S) navigation and blocks requests that resolve to loopback, private, link-local, multicast, or unspecified IP addresses. These application-level checks do not replace network egress controls; DNS rebinding and other network-layer risks must be considered in a production security review.

The container runs as the non-root `pwuser`. The Playwright Docker guide recommends a separate user and an additional seccomp profile for browsing untrusted websites; Render's managed runtime may not expose that Docker seccomp setting. Do not claim Chromium's internal sandbox is enabled unless the deployed container is explicitly verified with the required seccomp configuration. The Render container boundary and app-level guards are defense in depth, not a complete hostile-content isolation guarantee.
