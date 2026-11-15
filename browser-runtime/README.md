# CORTEX Browser Runtime

This service runs a real Chromium process through Playwright. CORTEX.Cowork remains on Vercel and connects to the runtime over HTTPS; it never pretends that a remote browser is a local browser process.

## Runtime, sessions, and agent access

Each `(tenant, session_id)` receives a separate in-memory Playwright `BrowserContext`, including its own cookies, local storage, tabs, and page state. The Chromium executable is a real process inside the runtime container. Contexts and profiles are ephemeral: stopping or restarting the runtime discards them. Persistent profile storage is intentionally not enabled until encrypted, tenant-scoped storage and deletion policies are designed.

The API provides URL navigation, back/forward/reload, multiple tabs, page text and accessibility snapshots, screenshots, pointer/keyboard input, and a Streamable HTTP MCP endpoint at `/mcp`. The MCP endpoint is an authenticated, session-aware facade built with the official MCP SDK and Playwright; it is not an unmodified `@playwright/mcp` server. The stock MCP server documents that it is not a security boundary, while this service requires Bearer authentication and explicit per-session routing.

For local OpenHands and ACP profile launches, CORTEX appends the conversation ID as the Browser MCP `session_id`. Cloud launches generate a random `cloud-browser-*` session ID, persist it as a conversation tag, append it to agent launch context, and let the Browser tab resolve that tag from conversation metadata. The agent profile must still have this remote MCP server selected; see **Connect the agent** below.

## No-cost hosting path

No Render service has been created. Render's API rejected the free web-service creation request with HTTP 402 requiring payment information; no card was added and no paid plan was selected. A local Docker Compose configuration is provided instead. It binds the runtime only to loopback, and it can be exposed temporarily to Vercel using a free Cloudflare Quick Tunnel. The tunnel URL is temporary and requires the host computer and both processes to remain running. See [`FREE-HOSTING.md`](./FREE-HOSTING.md) for the assessed limits and exact setup.

## Run with Docker Compose on your computer

From the repository root:

```sh
cd browser-runtime
cp .env.example .env
TOKEN="$(openssl rand -hex 32)"
printf 'BROWSER_RUNTIME_API_KEYS={"%s":"cortex-owner"}\nBROWSER_RUNTIME_ALLOWED_ORIGINS=https://cowork-chi-seven.vercel.app\n' "$TOKEN" > .env
chmod 600 .env
docker compose up --build
```

The container is exposed at `127.0.0.1:10000` only. In another terminal on the same host, start a temporary public tunnel:

```sh
cloudflared tunnel --url http://127.0.0.1:10000
```

Copy the `https://….trycloudflare.com` URL printed by Cloudflare. In CORTEX.Cowork's Browser tab, enter that base URL and the generated Bearer token. Then open `/mcp`, add a remote Streamable HTTP server at `https://….trycloudflare.com/mcp` with the same Bearer token, and select it in the intended agent profile. The tunnel address changes when it is restarted. Do not use an e-mail-protected Quick Tunnel for this non-interactive MCP connection.

## Configuration and security

`BROWSER_RUNTIME_API_KEYS` is a JSON object mapping high-entropy Bearer tokens to stable tenant identifiers. Generate a distinct token per authorized user and store it only in the runtime's environment or secrets manager; never commit it or place it in a `VITE_*` variable. The Browser tab stores the URL in local storage and the token only in session storage for that browser tab.

`BROWSER_RUNTIME_ALLOWED_ORIGINS` accepts comma-separated exact frontend origins. The Docker example defaults to `https://cowork-chi-seven.vercel.app`; CORS is not an authentication boundary. The service rejects non-HTTP(S) navigation and blocks URLs resolving to loopback, private, link-local, multicast, or unspecified IP addresses. Application-level checks do not replace outbound network controls; DNS rebinding and other network-layer risks remain part of production security review.

The container runs as non-root `pwuser`. Playwright recommends a separate user and an additional seccomp profile when browsing untrusted sites. The project does not claim Chromium's internal sandbox is enabled unless that profile is configured and verified. The container and BrowserContexts provide defense in depth, not a guarantee against hostile pages or browser vulnerabilities.

## Checks

With a running runtime and dependencies installed, run the smoke test from this directory:

```sh
npm ci
BROWSER_RUNTIME_URL=http://127.0.0.1:10000 \
BROWSER_RUNTIME_API_KEY='<primary-token>' \
BROWSER_RUNTIME_SECOND_API_KEY='<token-mapped-to-another-tenant>' \
npm run smoke
```

The test visits public demonstration pages, submits a sample form, verifies navigation and screenshots, exercises click/type/tab controls, checks per-session and cross-tenant isolation, CORS, bearer authentication, the SSRF guard, and MCP tool discovery/calls. It is an integration test; use a throwaway runtime and do not submit real data.

## Future Render deployment

If a paid or payment-eligible Render workspace is intentionally chosen later, create a Docker Web Service from the repository root using `browser-runtime/Dockerfile` and `/healthz` as the health check. Select a plan with adequate memory for Chromium and verify the required container security profile before exposing the service. The free-plan feasibility review and the no-card block are documented in [`FREE-HOSTING.md`](./FREE-HOSTING.md).
