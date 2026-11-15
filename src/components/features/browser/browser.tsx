import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { useUserConversation } from "#/hooks/query/use-user-conversation";
import { useOptionalConversationId } from "#/hooks/use-conversation-id";
import { I18nKey } from "#/i18n/declaration";
import { CONVERSATION_LAUNCH_PREFIX } from "#/stores/conversation-launch-store";
import { randomUUID } from "#/utils/random-uuid";
import {
  clearBrowserRuntimeToken,
  closeBrowserRuntimeTab,
  getBrowserRuntimeScreenshot,
  getBrowserRuntimeState,
  postBrowserRuntimeAction,
  readBrowserRuntimeConfig,
  saveBrowserRuntimeConfig,
  selectBrowserRuntimeTab,
  type BrowserRuntimeConfig,
  type BrowserRuntimeState,
} from "./browser-runtime-client";
import { BrowserChromeBar } from "./browser-chrome-bar";

const BROWSER_VIEWPORT_WIDTH = 1365;
const BROWSER_VIEWPORT_HEIGHT = 900;
const BROWSER_POLL_INTERVAL_MS = 1200;
const STANDALONE_SESSION_STORAGE_KEY = "cortex-browser-standalone-session";

function getSessionId(conversationId: string | null | undefined): string {
  if (conversationId) return conversationId;
  try {
    const existing = window.sessionStorage.getItem(
      STANDALONE_SESSION_STORAGE_KEY,
    );
    if (existing) return existing;
    const created = `standalone-${randomUUID()}`;
    window.sessionStorage.setItem(STANDALONE_SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return `standalone-${randomUUID()}`;
  }
}

function normalizePageUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function BrowserPanel() {
  const { t } = useTranslation("openhands");
  const { conversationId } = useOptionalConversationId();
  const activeBackend = useActiveBackend();
  const isCloudBackend = activeBackend.backend.kind === "cloud";
  const isPendingCloudConversation = Boolean(
    isCloudBackend &&
    conversationId &&
    (conversationId.startsWith("task-") ||
      conversationId.startsWith(CONVERSATION_LAUNCH_PREFIX)),
  );
  const conversationQuery = useUserConversation(
    isCloudBackend && !isPendingCloudConversation ? conversationId : null,
  );
  const browserSessionId =
    conversationQuery.data?.tags?.cortex_browser_session_id;
  const isBrowserSessionReady =
    !isPendingCloudConversation &&
    (!isCloudBackend ||
      !conversationId ||
      Boolean(browserSessionId) ||
      conversationQuery.isFetched);
  const sessionId = useMemo(
    () =>
      getSessionId(
        isPendingCloudConversation ? null : browserSessionId || conversationId,
      ),
    [browserSessionId, conversationId, isPendingCloudConversation],
  );
  const [config, setConfig] = useState<BrowserRuntimeConfig>(() =>
    readBrowserRuntimeConfig(),
  );
  const [runtimeUrlInput, setRuntimeUrlInput] = useState(config.baseUrl);
  const [tokenInput, setTokenInput] = useState(config.accessToken);
  const [state, setState] = useState<BrowserRuntimeState | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [error, setError] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const screenshotUrlRef = useRef("");

  const updateScreenshot = useCallback(
    async (currentConfig: BrowserRuntimeConfig) => {
      const blob = await getBrowserRuntimeScreenshot(currentConfig, sessionId);
      const nextUrl = URL.createObjectURL(blob);
      if (screenshotUrlRef.current)
        URL.revokeObjectURL(screenshotUrlRef.current);
      screenshotUrlRef.current = nextUrl;
      setScreenshotUrl(nextUrl);
    },
    [sessionId],
  );

  const refresh = useCallback(
    async (currentConfig: BrowserRuntimeConfig) => {
      const nextState = await getBrowserRuntimeState(currentConfig, sessionId);
      setState(nextState);
      const activeTab = nextState.tabs.find(
        (tab) => tab.id === nextState.activeTabId,
      );
      setUrlInput(
        activeTab?.url && activeTab.url !== "about:blank" ? activeTab.url : "",
      );
      await updateScreenshot(currentConfig);
    },
    [sessionId, updateScreenshot],
  );

  const connect = useCallback(
    async (candidate: BrowserRuntimeConfig) => {
      if (!isBrowserSessionReady) return;
      setIsBusy(true);
      setError("");
      try {
        saveBrowserRuntimeConfig(candidate);
        const normalized = {
          baseUrl: candidate.baseUrl.trim().replace(/\/+$/, ""),
          accessToken: candidate.accessToken.trim(),
        };
        await refresh(normalized);
        setConfig(normalized);
        setRuntimeUrlInput(normalized.baseUrl);
        setTokenInput(normalized.accessToken);
        setIsConnected(true);
        setIsConfiguring(false);
      } catch {
        setIsConnected(false);
        setError(t(I18nKey.BROWSER$CONNECTION_FAILED));
      } finally {
        setIsBusy(false);
      }
    },
    [isBrowserSessionReady, refresh, t],
  );

  useEffect(() => {
    if (!isBrowserSessionReady || !config.baseUrl || !config.accessToken)
      return;
    let cancelled = false;
    void refresh(config)
      .then(() => {
        if (!cancelled) setIsConnected(true);
      })
      .catch(() => {
        if (!cancelled) {
          setIsConnected(false);
          setError(t(I18nKey.BROWSER$CONNECTION_FAILED));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [config, isBrowserSessionReady, refresh, t]);

  useEffect(() => {
    if (!isConnected || !isBrowserSessionReady) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const nextState = await getBrowserRuntimeState(config, sessionId);
        if (cancelled) return;
        setState(nextState);
        const activeTab = nextState.tabs.find(
          (tab) => tab.id === nextState.activeTabId,
        );
        setUrlInput(
          activeTab?.url && activeTab.url !== "about:blank"
            ? activeTab.url
            : "",
        );
        await updateScreenshot(config);
      } catch {
        if (!cancelled) setError(t(I18nKey.BROWSER$CONNECTION_FAILED));
      } finally {
        if (!cancelled) timer = setTimeout(poll, BROWSER_POLL_INTERVAL_MS);
      }
    };
    timer = setTimeout(poll, BROWSER_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    config,
    isBrowserSessionReady,
    isConnected,
    sessionId,
    t,
    updateScreenshot,
  ]);

  useEffect(
    () => () => {
      if (screenshotUrlRef.current)
        URL.revokeObjectURL(screenshotUrlRef.current);
    },
    [],
  );

  const runAction = useCallback(
    async (
      action:
        | "navigate"
        | "back"
        | "forward"
        | "reload"
        | "tabs"
        | "click"
        | "type"
        | "press",
      payload: Record<string, string | number> = {},
    ) => {
      if (!isConnected || !isBrowserSessionReady) return;
      setIsBusy(true);
      setError("");
      try {
        const result = await postBrowserRuntimeAction<BrowserRuntimeState>(
          config,
          sessionId,
          action,
          payload,
        );
        if (result && "tabs" in result) setState(result);
        await refresh(config);
      } catch {
        setError(t(I18nKey.BROWSER$ACTION_FAILED));
      } finally {
        setIsBusy(false);
      }
    },
    [config, isBrowserSessionReady, isConnected, refresh, sessionId, t],
  );

  const navigate = useCallback(() => {
    const normalized = normalizePageUrl(urlInput);
    if (!normalized) {
      setError(t(I18nKey.BROWSER$INVALID_ADDRESS));
      return;
    }
    setUrlInput(normalized);
    void runAction("navigate", { url: normalized });
  }, [runAction, t, urlInput]);

  const newTab = useCallback(async () => {
    if (!isConnected || !isBrowserSessionReady) return;
    setIsBusy(true);
    try {
      const result = await postBrowserRuntimeAction<
        BrowserRuntimeState & { openedTabId?: string }
      >(config, sessionId, "tabs", {});
      setState(result);
      await refresh(config);
    } catch {
      setError(t(I18nKey.BROWSER$ACTION_FAILED));
    } finally {
      setIsBusy(false);
    }
  }, [config, isBrowserSessionReady, isConnected, refresh, sessionId, t]);

  const selectTab = useCallback(
    async (tabId: string) => {
      if (!isBrowserSessionReady) return;
      setIsBusy(true);
      try {
        setState(await selectBrowserRuntimeTab(config, sessionId, tabId));
        await refresh(config);
      } catch {
        setError(t(I18nKey.BROWSER$ACTION_FAILED));
      } finally {
        setIsBusy(false);
      }
    },
    [config, isBrowserSessionReady, refresh, sessionId, t],
  );

  const closeTab = useCallback(
    async (tabId: string) => {
      if (!isBrowserSessionReady) return;
      setIsBusy(true);
      try {
        setState(await closeBrowserRuntimeTab(config, sessionId, tabId));
        await refresh(config);
      } catch {
        setError(t(I18nKey.BROWSER$ACTION_FAILED));
      } finally {
        setIsBusy(false);
      }
    },
    [config, isBrowserSessionReady, refresh, sessionId, t],
  );

  const handleRemoteClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const image = imageRef.current;
      if (!image || event.target !== image) return;
      const bounds = image.getBoundingClientRect();
      const x =
        ((event.clientX - bounds.left) / bounds.width) * BROWSER_VIEWPORT_WIDTH;
      const y =
        ((event.clientY - bounds.top) / bounds.height) *
        BROWSER_VIEWPORT_HEIGHT;
      void runAction("click", { x: Math.round(x), y: Math.round(y) });
    },
    [runAction],
  );

  const handleRemoteKey = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.target !== event.currentTarget || !isConnected) return;
      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        void runAction("type", { text: event.key });
        return;
      }
      if (
        [
          "Enter",
          "Tab",
          "Backspace",
          "Escape",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Delete",
          "Home",
          "End",
          "PageUp",
          "PageDown",
          "Space",
        ].includes(event.key)
      ) {
        event.preventDefault();
        void runAction("press", {
          key: event.key === " " ? "Space" : event.key,
        });
      }
    },
    [isConnected, runAction],
  );

  const disconnect = useCallback(() => {
    clearBrowserRuntimeToken();
    setConfig({ baseUrl: config.baseUrl, accessToken: "" });
    setTokenInput("");
    setState(null);
    setIsConnected(false);
    setIsConfiguring(true);
    setError("");
  }, [config.baseUrl]);

  const activeUrl =
    state?.tabs.find((tab) => tab.id === state.activeTabId)?.url ?? "";
  const hasPage = Boolean(activeUrl && activeUrl !== "about:blank");
  const showSetup = isConfiguring || !config.accessToken || !config.baseUrl;

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col text-muted"
      data-testid="browser-panel"
    >
      {!showSetup ? (
        <BrowserChromeBar
          url={urlInput}
          onUrlChange={setUrlInput}
          onNavigate={navigate}
          onBack={() => void runAction("back")}
          onForward={() => void runAction("forward")}
          onReload={() => void runAction("reload")}
          onNewTab={() => void newTab()}
          onSelectTab={(tabId) => void selectTab(tabId)}
          onCloseTab={(tabId) => void closeTab(tabId)}
          tabs={state?.tabs ?? []}
          activeTabId={state?.activeTabId ?? ""}
          hasPage={hasPage}
          isBusy={isBusy}
        />
      ) : null}
      {showSetup ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-surface p-6">
          <form
            className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-border bg-surface-raised p-5 shadow-sm"
            onSubmit={(event) => {
              event.preventDefault();
              void connect({
                baseUrl: runtimeUrlInput,
                accessToken: tokenInput,
              });
            }}
          >
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {t(I18nKey.BROWSER$CONNECT_TITLE)}
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                {t(I18nKey.BROWSER$CONNECT_DESCRIPTION)}
              </p>
              <p className="mt-2 text-xs text-text-secondary">
                {t(I18nKey.BROWSER$AGENT_SETUP_HINT)}
              </p>
            </div>
            <label className="flex flex-col gap-1 text-sm text-foreground">
              {t(I18nKey.BROWSER$RUNTIME_URL)}
              <input
                type="url"
                required
                autoComplete="url"
                value={runtimeUrlInput}
                onChange={(event) => setRuntimeUrlInput(event.target.value)}
                className="min-h-9 rounded-md border border-border bg-surface px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-focus"
                placeholder={t(I18nKey.BROWSER$RUNTIME_URL_HINT)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-foreground">
              {t(I18nKey.BROWSER$ACCESS_TOKEN)}
              <input
                type="password"
                required
                autoComplete="current-password"
                value={tokenInput}
                aria-label={t(I18nKey.BROWSER$ACCESS_TOKEN)}
                onChange={(event) => setTokenInput(event.target.value)}
                className="min-h-9 rounded-md border border-border bg-surface px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-focus"
              />
              <span className="text-xs text-text-secondary">
                {t(I18nKey.BROWSER$TOKEN_HINT)}
              </span>
            </label>
            {error ? (
              <p role="alert" className="text-sm text-feedback-error">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={isBusy}
              className="min-h-9 rounded-md bg-accent px-4 text-sm font-medium text-on-accent disabled:opacity-50"
            >
              {isBusy
                ? t(I18nKey.BROWSER$CONNECTING)
                : t(I18nKey.BROWSER$CONNECT)}
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surface p-2">
            {screenshotUrl ? (
              <button
                type="button"
                className="flex max-h-full max-w-full items-center justify-center border-0 bg-transparent p-0 outline-none"
                onKeyDown={handleRemoteKey}
                onClick={(event) => {
                  event.currentTarget.focus();
                  handleRemoteClick(event);
                }}
                aria-label={t(I18nKey.BROWSER$REMOTE_VIEW)}
              >
                <img
                  ref={imageRef}
                  src={screenshotUrl}
                  alt={t(I18nKey.BROWSER$SCREENSHOT_ALT)}
                  className="max-h-full max-w-full cursor-crosshair object-contain shadow-sm"
                  draggable={false}
                />
              </button>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center text-sm text-text-secondary">
                <p>{t(I18nKey.BROWSER$NO_PAGE_LOADED)}</p>
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-tertiary"
                  onClick={() => setIsConfiguring(true)}
                >
                  {t(I18nKey.BROWSER$CHANGE_CONNECTION)}
                </button>
              </div>
            )}
          </div>
          <div className="flex min-h-8 shrink-0 items-center gap-2 border-t border-border px-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-text-tertiary">
              {activeUrl || t(I18nKey.BROWSER$NO_PAGE_LOADED)}
            </span>
            {error ? (
              <span
                role="alert"
                className="max-w-1/2 truncate text-feedback-error"
                title={error}
              >
                {error}
              </span>
            ) : null}
            <button
              type="button"
              className="shrink-0 rounded px-2 py-1 text-text-secondary hover:bg-tertiary"
              onClick={disconnect}
            >
              {t(I18nKey.BROWSER$DISCONNECT)}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
