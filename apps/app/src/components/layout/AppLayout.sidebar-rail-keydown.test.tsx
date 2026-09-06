// @vitest-environment jsdom
//
// sidebar.railToggle 的**键盘事件级**集成测试：用真实 AppCommandProvider（而不是
// AppLayout.sidebar-rail.test 里捕获 handler 闭包的 mock），mock useSystemConfig
// 的 keybindings 返回 ⌘⇧\（sidebar.railToggle）与 ⌘\（sidebar.toggle），然后向
// window 派发真实 KeyboardEvent，验证：
//   - provider 的 keydown 监听真的匹配到 ⌘⇧\ 绑定并 dispatch（defaultPrevented）
//   - dispatch 落到 AppLayout 真实 SidebarStateBridge 注册的 railToggle handler
//   - 真实 sidebarRailAtom / sidebarOpenAtom 翻转并写入 localStorage
//   - SidebarRailToggle 的 aria 标签随 rail 翻转
// 触发链：window keydown → AppCommandProvider.handleKeyboardEvent（真实绑定匹配）
//   → dispatch → SidebarStateBridge（真实 useAppCommandHandler）→ 真实原子与存储。
// 与只测 handler 闭包（commandMocks.handlers.get("...")()）的区别：按键绑定解析、
// 修饰键匹配、context 判定、preventDefault 全走真实路径。
//
// 其余模块 mock（query hooks、daemon、header 等）与 AppLayout.sidebar-rail.test
// 同款 —— 只是让 AppLayout 在无服务端配置的 jsdom 里可渲染，不参与被断言逻辑；
// CommandPalette 一并置空（provider 为真时它会自行初始化查询流，与本题无关）。

import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, type AppKeybinding } from "@bb/domain";
import { createStore, Provider } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { createAppQueryClient } from "@/lib/query-client";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { AppLayout } from "./AppLayout";

const SIDEBAR_RAIL_STORAGE_KEY = "bb.sidebar.rail";
const SIDEBAR_OPEN_STORAGE_KEY = "bb.sidebar.open";

const MAIN_SURFACE = { all: ["mainSurface" as const], none: [] };

const RAIL_TOGGLE_BINDING: AppKeybinding = {
  command: "sidebar.railToggle",
  desktopOnly: false,
  shortcut: {
    key: "\\",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: true,
  },
  when: MAIN_SURFACE,
};

const SIDEBAR_TOGGLE_BINDING: AppKeybinding = {
  command: "sidebar.toggle",
  desktopOnly: false,
  shortcut: {
    key: "\\",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: false,
  },
  when: MAIN_SURFACE,
};

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: {
        ...defaultAppSettings,
        showKeyboardHints: true,
      },
      keybindings: [SIDEBAR_TOGGLE_BINDING, RAIL_TOGGLE_BINDING],
      defaultKeybindings: [SIDEBAR_TOGGLE_BINDING, RAIL_TOGGLE_BINDING],
      experiments: {
        editMessages: false,
      },
    },
  }),
  useSystemVersion: () => ({ data: "0.0.0-test" }),
  useKnownProviderModelCatalogScope: () => ({ data: [] }),
  useSystemProviders: () => ({ data: [] }),
  useSystemProviderInfo: () => ({ data: null }),
  useSystemExecutionOptions: () => ({ data: [] }),
  useCliSkillsStatus: () => ({ data: [] }),
  useHostProviderCliStatus: () => ({ data: [] }),
  useSystemProviderStates: () => ({ data: [] }),
  useSystemProviderUsageLimits: () => ({ data: null }),
}));

vi.mock("@/components/commands/CommandPalette", () => ({
  CommandPalette: () => null,
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ hasDaemon: false }),
  useLocalHostDaemonAccess: () => ({ accessState: "unavailable" }),
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  ProjectActionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  ThreadActionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/dialogs/ProjectPathDialog", () => ({
  ProjectPathDialog: () => null,
}));

vi.mock("./AppPageHeader", () => ({
  HEADER_ICON_BUTTON_CLASS: "header-icon-button",
  AppPageHeader: () => <header />,
}));

vi.mock("@/lib/bb-desktop", () => ({
  BROWSER_SIDEBAR_TRIGGER_INSET_CLASS: "",
  CHROME_ROW_CLASS: "",
  DEFAULT_DESKTOP_WINDOW_STATE: { isFullScreen: false },
  MACOS_CHROME_CONTROL_AXIS_CLASS: "",
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS: "",
  MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS: "",
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS: "",
  MACOS_WINDOW_DRAG_CLASS: "",
  MACOS_WINDOW_NO_DRAG_CLASS: "",
  getBbDesktopInfo: () => null,
  shouldReserveMacosTrafficLights: () => false,
  shouldUseMacosDesktopChrome: () => false,
}));

vi.mock("@/lib/favicon-color-preference", () => ({
  useFaviconBadge: vi.fn(),
}));

vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    hostId: null,
    hostName: null,
    isCreating: false,
    platform: "darwin",
    projectPathDialog: { onOpenChange: vi.fn(), target: null },
    submitProjectPath: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      sections: [],
      personalProject: {
        id: "proj_personal",
        kind: "personal",
        name: "Personal",
        sources: [],
        threads: [],
        defaultExecutionOptions: null,
        createdAt: 1,
        updatedAt: 1,
      },
      projects: [],
    },
    isError: false,
    isSuccess: true,
  }),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  didThreadDetailBootstrapRefreshAfterMount: () => true,
  useThread: () => ({ data: undefined }),
  useThreadDetailBootstrap: () => ({ isError: false, isSuccess: false }),
  useThreadPendingInteractions: () => ({ data: undefined }),
  getLatestPendingInteraction: () => null,
}));

function getPanel(): HTMLElement {
  const panel = document.querySelector('[data-variant="sidebar"]');
  if (!(panel instanceof HTMLElement)) throw new Error("missing sidebar panel");
  return panel;
}

function getToggle(): HTMLElement {
  const toggle = document.querySelector('[data-testid="sidebar-rail-toggle"]');
  if (!(toggle instanceof HTMLElement)) throw new Error("missing rail toggle");
  return toggle;
}

function railOn(panel: HTMLElement): boolean {
  return panel.getAttribute("data-collapsible") === "icon";
}

function openState(panel: HTMLElement): string | null {
  return panel.getAttribute("data-state");
}

function pressMacChord(key: string, options: { shift?: boolean } = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: key === "\\" ? "Backslash" : undefined,
    key,
    metaKey: true,
    shiftKey: options.shift === true,
  });
  // 真实用户按键是在 React 事件系统之外到达 window 监听器的；用 act 包住
  // dispatch，让 provider handler 里的 setState（rail/open 原子）同步 flush。
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe("AppLayout railToggle keyboard integration", () => {
  let frameCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    window.localStorage.clear();
    frameCallbacks = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frameCallbacks.push(cb);
      return frameCallbacks.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function renderLayout() {
    render(
      <Provider store={createStore()}>
        <QueryClientProvider client={createAppQueryClient()}>
          <MemoryRouter initialEntries={["/"]}>
            <AppCommandProvider>
              <AppLayout>
                <div data-testid="route-content">Route</div>
              </AppLayout>
            </AppCommandProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </Provider>,
    );
    void frameCallbacks;
  }

  it("⌘⇧\\ keydown flips the real bridge into and out of the icon rail, persisting bb.sidebar.rail", () => {
    renderLayout();
    expect(railOn(getPanel())).toBe(false);
    expect(openState(getPanel())).toBe("expanded");
    expect(getToggle().getAttribute("aria-label")).toMatch(
      /^Collapse to icon rail \(/,
    );
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBeNull();

    const firstChord = pressMacChord("\\", { shift: true });
    expect(firstChord.defaultPrevented).toBe(true);
    expect(railOn(getPanel())).toBe(true);
    expect(openState(getPanel())).toBe("expanded");
    expect(getToggle().getAttribute("aria-label")).toMatch(
      /^Expand icon rail \(/,
    );
    expect(getToggle().getAttribute("aria-label")).toContain("\\");
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBe("true");

    const secondChord = pressMacChord("\\", { shift: true });
    expect(secondChord.defaultPrevented).toBe(true);
    expect(railOn(getPanel())).toBe(false);
    expect(getToggle().getAttribute("aria-label")).toMatch(
      /^Collapse to icon rail \(/,
    );
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBe("false");
  });

  it("⌘\\ (no shift) resolves to sidebar.toggle and closes the sidebar without touching the rail", () => {
    renderLayout();
    expect(openState(getPanel())).toBe("expanded");
    expect(window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBeNull();

    const chord = pressMacChord("\\");
    expect(chord.defaultPrevented).toBe(true);

    expect(openState(getPanel())).toBe("collapsed");
    expect(getPanel().getAttribute("data-collapsible")).toBe("offcanvas");
    expect(railOn(getPanel())).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("false");
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBeNull();
  });

  it("reopening with ⌘\\ returns to the full sidebar, and rail stays a separate persisted preference", () => {
    window.localStorage.setItem(SIDEBAR_RAIL_STORAGE_KEY, "true");
    renderLayout();
    expect(railOn(getPanel())).toBe(true);
    expect(openState(getPanel())).toBe("expanded");

    const closeChord = pressMacChord("\\");
    expect(closeChord.defaultPrevented).toBe(true);
    expect(openState(getPanel())).toBe("collapsed");
    expect(getPanel().getAttribute("data-collapsible")).toBe("offcanvas");
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBe("true");

    const openChord = pressMacChord("\\");
    expect(openChord.defaultPrevented).toBe(true);
    expect(openState(getPanel())).toBe("expanded");
    expect(railOn(getPanel())).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBe("true");
    expect(window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("true");
  });
});
