import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const runtimeMocks = vi.hoisted(() => ({
  readBrowserRuntimeConfig: vi.fn(),
  saveBrowserRuntimeConfig: vi.fn(),
  clearBrowserRuntimeToken: vi.fn(),
  getBrowserRuntimeState: vi.fn(),
  getBrowserRuntimeScreenshot: vi.fn(),
  getBrowserRuntimeContent: vi.fn(),
  postBrowserRuntimeAction: vi.fn(),
  selectBrowserRuntimeTab: vi.fn(),
  closeBrowserRuntimeTab: vi.fn(),
}));

vi.mock("#/hooks/use-conversation-id", () => ({
  useOptionalConversationId: () => ({ conversationId: "test-conversation-id" }),
  useConversationId: () => ({ conversationId: "test-conversation-id" }),
}));

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual("react-i18next");
  return {
    ...(actual as object),
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { changeLanguage: () => new Promise(() => {}) },
    }),
  };
});

vi.mock(
  "#/components/features/browser/browser-runtime-client",
  () => runtimeMocks,
);

import { BrowserPanel } from "#/components/features/browser/browser";

const blankState = {
  sessionId: "test-conversation-id",
  activeTabId: "tab-one",
  tabs: [{ id: "tab-one", url: "about:blank", title: "", active: true }],
};

let currentState = blankState;

beforeEach(() => {
  currentState = blankState;
  runtimeMocks.readBrowserRuntimeConfig.mockReturnValue({
    baseUrl: "",
    accessToken: "",
  });
  runtimeMocks.saveBrowserRuntimeConfig.mockImplementation(() => undefined);
  runtimeMocks.clearBrowserRuntimeToken.mockImplementation(() => undefined);
  runtimeMocks.getBrowserRuntimeState.mockImplementation(
    async () => currentState,
  );
  runtimeMocks.getBrowserRuntimeScreenshot.mockResolvedValue(
    new Blob(["jpeg"], { type: "image/jpeg" }),
  );
  runtimeMocks.getBrowserRuntimeContent.mockResolvedValue({
    url: "",
    title: "",
    text: "",
    ariaSnapshot: "",
  });
  runtimeMocks.postBrowserRuntimeAction.mockImplementation(
    async (_config, sessionId, action, body) => {
      if (action === "navigate") {
        currentState = {
          sessionId,
          activeTabId: "tab-one",
          tabs: [
            {
              id: "tab-one",
              url: String(body.url),
              title: "Example",
              active: true,
            },
          ],
        };
      }
      return currentState;
    },
  );
  runtimeMocks.selectBrowserRuntimeTab.mockResolvedValue(blankState);
  runtimeMocks.closeBrowserRuntimeTab.mockResolvedValue(blankState);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:browser-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Browser", () => {
  it("shows the remote runtime setup instead of rendering a simulated page", () => {
    render(<BrowserPanel />);

    expect(screen.getByText("BROWSER$CONNECT_TITLE")).toBeInTheDocument();
    expect(screen.getByLabelText("BROWSER$RUNTIME_URL")).toBeInTheDocument();
    expect(screen.getByLabelText("BROWSER$ACCESS_TOKEN")).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      screen.queryByAltText("BROWSER$SCREENSHOT_ALT"),
    ).not.toBeInTheDocument();
  });

  it("connects to the runtime, displays its real screenshot, and navigates the shared session", async () => {
    render(<BrowserPanel />);

    fireEvent.change(screen.getByLabelText("BROWSER$RUNTIME_URL"), {
      target: { value: "https://browser-service.onrender.com" },
    });
    fireEvent.change(screen.getByLabelText("BROWSER$ACCESS_TOKEN"), {
      target: { value: "a-secure-test-token-with-more-than-32-characters" },
    });
    fireEvent.click(screen.getByRole("button", { name: "BROWSER$CONNECT" }));

    await screen.findByTestId("browser-chrome-bar");
    expect(runtimeMocks.getBrowserRuntimeState).toHaveBeenCalledWith(
      {
        baseUrl: "https://browser-service.onrender.com",
        accessToken: "a-secure-test-token-with-more-than-32-characters",
      },
      "test-conversation-id",
    );
    expect(screen.getByAltText("BROWSER$SCREENSHOT_ALT")).toHaveAttribute(
      "src",
      "blob:browser-preview",
    );
    expect(screen.getByTestId("browser-chrome-bar")).toHaveClass("min-h-8.5");
    expect(screen.getByRole("button", { name: "BUTTON$BACK" })).toBeDisabled();

    const address = screen.getByTestId("browser-chrome-url");
    fireEvent.change(address, { target: { value: "https://example.com" } });
    fireEvent.submit(address.closest("form")!);

    await waitFor(() => {
      expect(runtimeMocks.postBrowserRuntimeAction).toHaveBeenCalledWith(
        {
          baseUrl: "https://browser-service.onrender.com",
          accessToken: "a-secure-test-token-with-more-than-32-characters",
        },
        "test-conversation-id",
        "navigate",
        { url: "https://example.com/" },
      );
    });
    await waitFor(() => expect(address).toHaveValue("https://example.com/"));
  });
});
