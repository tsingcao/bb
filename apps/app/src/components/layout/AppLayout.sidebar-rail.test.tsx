// @vitest-environment jsdom
//
// rail 持久化契约的 AppLayout 级测试（sidebar.test.tsx 的 rail describe 负责
// SidebarProvider 组件级行为；本文件负责 SidebarStateBridge 的原子桥接层）：
//   - bb.sidebar.rail 原子经 localStorage 持久化（getOnInit + onMount 每次挂载重读）
//   - 重新挂载（模拟 reload）后从存储恢复 rail 态
//   - 启用 rail 时强制展开侧栏（forced-open-on-rail）：handleRailChange(true)
//     先 handleOpenChange(true) 再 setRail(true)，不允许「rail 开 + 侧栏关」并存
//   - 规则是**单向**的：rail 开着时关闭侧栏（sidebar.toggle / ⌘\）不解除 rail——
//     open=false 时整个侧栏区 offcanvas（icon rail 也不残留半态），rail 作为持久化
//     偏好保留，下次重开仍回 icon rail 形态（见「closing while the rail is on」测试）

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, Provider } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { createAppQueryClient } from "@/lib/query-client";
import { AppLayout } from "./AppLayout";

const SIDEBAR_RAIL_STORAGE_KEY = "bb.sidebar.rail";
const SIDEBAR_OPEN_STORAGE_KEY = "bb.sidebar.open";

// 捕获 useAppCommandHandler 注册的回调，测试里直接触发命令路径
// （sidebar.toggle / sidebar.railToggle 都由 SidebarStateBridge 注册）。
const commandMocks = vi.hoisted(() => ({
  handlers: new Map<string, () => boolean>(),
  shortcuts: new Map<string, { label: string; ariaKeyshortcuts: string }>(),
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: (id: string, handler: () => boolean) => {
    commandMocks.handlers.set(id, handler);
  },
  useAppCommandShortcut: (id: string) => commandMocks.shortcuts.get(id) ?? null,
  useAppCommandShortcuts: () => new Map(),
  useAppCommandRunner: () => ({
    dispatch: () => false,
    isCommandAvailable: () => false,
  }),
  useIsAppCommandModifierHeld: () => false,
  useIndexedAppCommandHandlers: () => new Map(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
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

// data-state / data-collapsible 挂在 Sidebar 根 wrapper（data-variant=sidebar）上，
// 与 sidebar.test.tsx 的 getRailPanel 同一定位（panel 是内部的固定宽面板）。
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

describe("AppLayout sidebar rail persistence", () => {
  let frameCallbacks: FrameRequestCallback[];
  // 每个测试用全新 jotai store：atomWithStorage 的 onMount 只在 atom 首次被
  // 订阅时从 localStorage 重读（jotai 2.19 实测：重挂载不重读）。fresh store
  // → 每次测试都是该 store 的首次订阅 → 真实还原「启动时从存储恢复」语义。
  // 不 resetModules：保持单图，AppSidebar 用真实组件，Provider/query 上下文
  // 身份一致。
  beforeEach(() => {
    window.localStorage.clear();
    frameCallbacks = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frameCallbacks.push(cb);
      return frameCallbacks.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
    commandMocks.shortcuts.clear();
  });

  function renderLayout() {
    render(
      <Provider store={createStore()}>
        <QueryClientProvider client={createAppQueryClient()}>
          <MemoryRouter initialEntries={["/"]}>
            <AppLayout>
              <div data-testid="route-content">Route</div>
            </AppLayout>
          </MemoryRouter>
        </QueryClientProvider>
      </Provider>,
    );
  }

  it("boots with the rail off and never writes bb.sidebar.rail at first visit", () => {
    renderLayout();
    expect(railOn(getPanel())).toBe(false);
    expect(openState(getPanel())).toBe("expanded");
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBeNull();
  });

  it("restores a persisted rail state from bb.sidebar.rail on boot (reload restore)", () => {
    window.localStorage.setItem(SIDEBAR_RAIL_STORAGE_KEY, "true");
    renderLayout();
    expect(railOn(getPanel())).toBe(true);
    // 侧栏随 rail 一起展开（open 原子默认 true，且 rail 启用时强制展开）
    expect(openState(getPanel())).toBe("expanded");
  });

  it("clicking the rail toggle flips and persists bb.sidebar.rail", () => {
    renderLayout();
    expect(railOn(getPanel())).toBe(false);

    fireEvent.click(getToggle());
    expect(railOn(getPanel())).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBe("true");

    fireEvent.click(getToggle());
    expect(railOn(getPanel())).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBe("false");
  });

  it("survives a reload: the rail state round-trips through localStorage", () => {
    renderLayout();
    fireEvent.click(getToggle());
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBe("true");

    // 模拟刷新：卸载后重新挂载（atom onMount 会从存储重读）
    cleanup();
    renderLayout();
    expect(railOn(getPanel())).toBe(true);
    expect(openState(getPanel())).toBe("expanded");
  });

  it("enabling the rail forces the sidebar open even when it was closed", () => {
    window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false");
    renderLayout();
    expect(openState(getPanel())).toBe("collapsed");
    expect(railOn(getPanel())).toBe(false);

    fireEvent.click(getToggle());
    // forced-open-on-rail：rail 开 的同时侧栏必须展开
    expect(railOn(getPanel())).toBe(true);
    expect(openState(getPanel())).toBe("expanded");
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBe("true");
    expect(window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("true");
  });

  // --- sidebar.railToggle 命令路径（⌘⇧\）：与按钮同走 handleRailChange 桥 ---
  function railToggleHandler(): () => boolean {
    const handler = commandMocks.handlers.get("sidebar.railToggle");
    if (!handler) throw new Error("sidebar.railToggle handler not registered");
    return handler;
  }

  function sidebarToggleHandler(): () => boolean {
    const handler = commandMocks.handlers.get("sidebar.toggle");
    if (!handler) throw new Error("sidebar.toggle handler not registered");
    return handler;
  }

  it("railToggle command collapses to the icon rail, returns true, and persists", () => {
    renderLayout();
    expect(railOn(getPanel())).toBe(false);

    let cmdReturn: boolean | undefined;
    act(() => {
      cmdReturn = railToggleHandler()();
    });
    expect(cmdReturn).toBe(true);

    expect(railOn(getPanel())).toBe(true);
    expect(openState(getPanel())).toBe("expanded");
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBe("true");
  });

  it("railToggle command from the rail state expands back to the full sidebar", () => {
    window.localStorage.setItem(SIDEBAR_RAIL_STORAGE_KEY, "true");
    renderLayout();
    expect(railOn(getPanel())).toBe(true);

    let cmdReturn: boolean | undefined;
    act(() => {
      cmdReturn = railToggleHandler()();
    });
    expect(cmdReturn).toBe(true);

    expect(railOn(getPanel())).toBe(false);
    expect(openState(getPanel())).toBe("expanded");
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBe("false");
  });

  it("shows the railToggle shortcut hint in the sidebar trigger tooltip while the rail is on", () => {
    window.localStorage.setItem(SIDEBAR_RAIL_STORAGE_KEY, "true");
    commandMocks.shortcuts.set("sidebar.toggle", {
      label: "⌘\\",
      ariaKeyshortcuts: "Meta+\\",
    });
    commandMocks.shortcuts.set("sidebar.railToggle", {
      label: "⌘⇧\\",
      ariaKeyshortcuts: "Meta+Shift+\\",
    });
    vi.useFakeTimers();
    renderLayout();

    const trigger = document.querySelector('[data-sidebar="trigger"]');
    if (!(trigger instanceof HTMLElement)) throw new Error("missing trigger");
    // Radix Tooltip 在 pointerenter + pointermove 后按 delayDuration(700ms) 打开
    fireEvent.pointerEnter(trigger);
    fireEvent.pointerMove(trigger);
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getAllByText("Toggle sidebar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Expand icon rail").length).toBeGreaterThan(0);
    // tooltip 里 rail 药的 kbd 文本
    const pill = [...document.querySelectorAll("kbd")].find(
      (kbd) => kbd.textContent === "⌘⇧\\",
    );
    expect(pill).toBeDefined();
    vi.useRealTimers();
  });

  it("railToggle command forces the sidebar open when it was closed (command path)", () => {
    window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false");
    renderLayout();
    expect(openState(getPanel())).toBe("collapsed");

    let cmdReturn: boolean | undefined;
    act(() => {
      cmdReturn = railToggleHandler()();
    });
    expect(cmdReturn).toBe(true);

    expect(railOn(getPanel())).toBe(true);
    expect(openState(getPanel())).toBe("expanded");
    expect(window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("true");
  });

  // --- sidebar.toggle 命令路径（⌘\）：与 railToggle 对称的 handler 捕获测试 ---
  it("sidebar.toggle command collapses the open sidebar, returns true, and persists bb.sidebar.open", () => {
    renderLayout();
    expect(openState(getPanel())).toBe("expanded");
    expect(railOn(getPanel())).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBeNull();

    let cmdReturn: boolean | undefined;
    act(() => {
      cmdReturn = sidebarToggleHandler()();
    });
    expect(cmdReturn).toBe(true);

    expect(openState(getPanel())).toBe("collapsed");
    // 关掉后整个侧栏区 offcanvas（rail 本就没开，不残留任何侧栏形态）
    expect(getPanel().getAttribute("data-collapsible")).toBe("offcanvas");
    expect(window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("false");
    // sidebar.toggle 只动 open 原子：rail 偏好保持未写（无副作用）
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBeNull();
  });

  it("sidebar.toggle command from the closed state expands back to the full sidebar", () => {
    window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false");
    renderLayout();
    expect(openState(getPanel())).toBe("collapsed");
    expect(railOn(getPanel())).toBe(false);

    let cmdReturn: boolean | undefined;
    act(() => {
      cmdReturn = sidebarToggleHandler()();
    });
    expect(cmdReturn).toBe(true);

    expect(openState(getPanel())).toBe("expanded");
    // 无 rail 偏好时重开回完整侧栏（不是 icon rail）
    expect(railOn(getPanel())).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("true");
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBeNull();
  });

  it("closing the sidebar while the rail is on is allowed — rail persists and reopening returns to the icon rail", () => {
    // 逆向场景：rail 开（icon rail 形态）时用户点关闭钮 / ⌘\ —— 允许整体 offcanvas，
    // 不补「open=false → 解除 rail」规则：rail 是持久化偏好，关闭只藏整个侧栏区，
    // 重开仍回 icon rail（单向不变式：仅「启用 rail → 强制展开」一侧受约束）。
    window.localStorage.setItem(SIDEBAR_RAIL_STORAGE_KEY, "true");
    renderLayout();
    expect(railOn(getPanel())).toBe(true);
    expect(openState(getPanel())).toBe("expanded");

    // 关闭（与侧栏关闭钮同一条 handleOpenChange(false) 路径）
    let cmdReturn: boolean | undefined;
    act(() => {
      cmdReturn = sidebarToggleHandler()();
    });
    expect(cmdReturn).toBe(true);
    expect(openState(getPanel())).toBe("collapsed");
    // 关闭后整个侧栏区 offcanvas：icon 形态不残留半态，rail 偏好仍持久化
    expect(getPanel().getAttribute("data-collapsible")).toBe("offcanvas");
    expect(window.localStorage.getItem(SIDEBAR_RAIL_STORAGE_KEY)).toBe("true");
    expect(window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("false");

    // 重新打开 → 回到 icon rail（不是直接 full 侧栏）
    act(() => {
      cmdReturn = sidebarToggleHandler()();
    });
    expect(openState(getPanel())).toBe("expanded");
    expect(railOn(getPanel())).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("true");
  });
});
