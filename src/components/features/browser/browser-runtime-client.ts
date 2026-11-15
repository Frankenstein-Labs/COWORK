const BROWSER_RUNTIME_URL_KEY = "cortex-browser-runtime-url";
const BROWSER_RUNTIME_TOKEN_KEY = "cortex-browser-runtime-token";

type BrowserStorageKind = "localStorage" | "sessionStorage";

export type BrowserRuntimeConfig = {
  baseUrl: string;
  accessToken: string;
};

export type BrowserRuntimeTab = {
  id: string;
  url: string;
  title: string;
  active: boolean;
};

export type BrowserRuntimeState = {
  sessionId: string;
  tabs: BrowserRuntimeTab[];
  activeTabId: string;
};

function getStorage(kind: BrowserStorageKind): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window[kind];
  } catch {
    return null;
  }
}

export function readBrowserRuntimeConfig(): BrowserRuntimeConfig {
  const local = getStorage("localStorage");
  const session = getStorage("sessionStorage");
  return {
    baseUrl: local?.getItem(BROWSER_RUNTIME_URL_KEY) ?? "",
    accessToken: session?.getItem(BROWSER_RUNTIME_TOKEN_KEY) ?? "",
  };
}

export function saveBrowserRuntimeConfig(config: BrowserRuntimeConfig): void {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
  const parsed = new URL(baseUrl);
  const localDevelopmentHost = ["localhost", "127.0.0.1", "::1"].includes(
    parsed.hostname,
  );
  if (
    (!localDevelopmentHost && parsed.protocol !== "https:") ||
    (localDevelopmentHost && !["http:", "https:"].includes(parsed.protocol)) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Browser runtime must use HTTPS outside local development");
  }
  if (config.accessToken.trim().length < 32) {
    throw new Error("The access token must contain at least 32 characters");
  }
  const local = getStorage("localStorage");
  const session = getStorage("sessionStorage");
  if (!local || !session) throw new Error("Browser storage is unavailable");
  local.setItem(
    BROWSER_RUNTIME_URL_KEY,
    parsed.origin + parsed.pathname.replace(/\/+$/, ""),
  );
  session.setItem(BROWSER_RUNTIME_TOKEN_KEY, config.accessToken.trim());
}

export function clearBrowserRuntimeToken(): void {
  getStorage("sessionStorage")?.removeItem(BROWSER_RUNTIME_TOKEN_KEY);
}

function endpoint(
  config: BrowserRuntimeConfig,
  sessionId: string,
  suffix: string,
): string {
  const base = config.baseUrl.trim().replace(/\/+$/, "");
  if (!base || !config.accessToken)
    throw new Error("Browser runtime is not configured");
  return `${base}/api/sessions/${encodeURIComponent(sessionId)}/${suffix}`;
}

async function request<T>(
  config: BrowserRuntimeConfig,
  sessionId: string,
  suffix: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(endpoint(config, sessionId, suffix), {
    ...init,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    let message = `Browser runtime returned ${response.status}`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // Preserve the status message when the service did not return JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function getBrowserRuntimeState(
  config: BrowserRuntimeConfig,
  sessionId: string,
) {
  return request<BrowserRuntimeState>(config, sessionId, "state");
}

export function getBrowserRuntimeScreenshot(
  config: BrowserRuntimeConfig,
  sessionId: string,
) {
  return fetch(endpoint(config, sessionId, "screenshot"), {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    cache: "no-store",
  }).then(async (response) => {
    if (!response.ok)
      throw new Error(`Browser screenshot failed (${response.status})`);
    return response.blob();
  });
}

export function getBrowserRuntimeContent(
  config: BrowserRuntimeConfig,
  sessionId: string,
) {
  return request<{
    url: string;
    title: string;
    text: string;
    ariaSnapshot: string;
  }>(config, sessionId, "content");
}

export function postBrowserRuntimeAction<T = BrowserRuntimeState>(
  config: BrowserRuntimeConfig,
  sessionId: string,
  action:
    | "navigate"
    | "back"
    | "forward"
    | "reload"
    | "tabs"
    | "click"
    | "type"
    | "press",
  body: Record<string, string | number> = {},
) {
  return request<T>(config, sessionId, action, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function selectBrowserRuntimeTab(
  config: BrowserRuntimeConfig,
  sessionId: string,
  tabId: string,
) {
  return request<BrowserRuntimeState>(
    config,
    sessionId,
    `tabs/${encodeURIComponent(tabId)}/activate`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export function closeBrowserRuntimeTab(
  config: BrowserRuntimeConfig,
  sessionId: string,
  tabId: string,
) {
  return fetch(
    endpoint(config, sessionId, `tabs/${encodeURIComponent(tabId)}`),
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.accessToken}` },
      cache: "no-store",
    },
  ).then(async (response) => {
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(body.error || `Closing tab failed (${response.status})`);
    }
    return response.json() as Promise<BrowserRuntimeState>;
  });
}
