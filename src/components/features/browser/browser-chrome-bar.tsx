import { ArrowLeft, ArrowRight, Plus, RotateCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import type { BrowserRuntimeTab } from "./browser-runtime-client";

type BrowserChromeBarProps = {
  url: string;
  onUrlChange: (url: string) => void;
  onNavigate: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onNewTab: () => void;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  tabs: BrowserRuntimeTab[];
  activeTabId: string;
  hasPage: boolean;
  isBusy: boolean;
};

export function BrowserChromeBar({
  url,
  onUrlChange,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onNewTab,
  onSelectTab,
  onCloseTab,
  tabs,
  activeTabId,
  hasPage,
  isBusy,
}: BrowserChromeBarProps) {
  const { t } = useTranslation("openhands");
  const iconClassName = "size-3.5";
  const buttonClassName = cn(
    "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
    "text-text-secondary hover:bg-tertiary disabled:cursor-not-allowed disabled:opacity-40",
  );

  return (
    <div
      className="min-h-8.5 w-full shrink-0 border-b border-border bg-surface"
      data-testid="browser-chrome-bar"
    >
      <div className="flex min-h-8.5 items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          className={buttonClassName}
          onClick={onBack}
          disabled={!hasPage || isBusy}
          aria-label={t(I18nKey.BUTTON$BACK)}
          title={t(I18nKey.BUTTON$BACK)}
        >
          <ArrowLeft className={iconClassName} aria-hidden strokeWidth={2} />
        </button>
        <button
          type="button"
          className={buttonClassName}
          onClick={onForward}
          disabled={!hasPage || isBusy}
          aria-label={t(I18nKey.BROWSER$FORWARD)}
          title={t(I18nKey.BROWSER$FORWARD)}
        >
          <ArrowRight className={iconClassName} aria-hidden strokeWidth={2} />
        </button>
        <button
          type="button"
          className={buttonClassName}
          onClick={onReload}
          disabled={!hasPage || isBusy}
          aria-label={t(I18nKey.BUTTON$REFRESH)}
          title={t(I18nKey.BUTTON$REFRESH)}
        >
          <RotateCw className={iconClassName} aria-hidden strokeWidth={2} />
        </button>
        <form
          className="flex min-w-0 flex-1 items-center"
          onSubmit={(event) => {
            event.preventDefault();
            onNavigate();
          }}
        >
          <input
            className="min-h-7 min-w-0 flex-1 rounded-md border border-border bg-surface-raised px-2 text-xs leading-5 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-focus"
            data-testid="browser-chrome-url"
            aria-label={t(I18nKey.BROWSER$ADDRESS)}
            placeholder={t(I18nKey.BROWSER$ADDRESS)}
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            spellCheck={false}
            inputMode="url"
          />
        </form>
        <button
          type="button"
          className={buttonClassName}
          onClick={onNewTab}
          disabled={isBusy}
          aria-label={t(I18nKey.BROWSER$NEW_TAB)}
          title={t(I18nKey.BROWSER$NEW_TAB)}
        >
          <Plus className={iconClassName} aria-hidden strokeWidth={2} />
        </button>
      </div>
      {tabs.length > 0 ? (
        <div
          className="flex min-h-8 items-center gap-1 overflow-x-auto px-2 pb-1"
          role="tablist"
          aria-label={t(I18nKey.BROWSER$TABS)}
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                "group flex max-w-56 min-w-20 items-center gap-1 rounded-md border px-2 py-1 text-xs",
                tab.id === activeTabId
                  ? "border-border bg-surface-raised text-foreground"
                  : "border-transparent text-text-secondary hover:bg-tertiary",
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                role="tab"
                aria-selected={tab.id === activeTabId}
                onClick={() => onSelectTab(tab.id)}
                title={tab.title || tab.url || t(I18nKey.BROWSER$NEW_TAB)}
              >
                {tab.title || tab.url || t(I18nKey.BROWSER$NEW_TAB)}
              </button>
              <button
                type="button"
                className="inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-tertiary"
                aria-label={`${t(I18nKey.BROWSER$CLOSE_TAB)} ${tab.title || tab.url}`}
                title={t(I18nKey.BROWSER$CLOSE_TAB)}
                onClick={() => onCloseTab(tab.id)}
              >
                <X className="size-3" aria-hidden strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
