// @vitest-environment jsdom
//
// 端到端断言：从命令面板（CommandPalette，真实 UI + 真实 AppCommandProvider 分发链）
// 触发 sidebar.railToggle → 侧栏进入/退出 icon rail，SidebarRailToggle 的
// aria 标签与 chevron 同步翻转。
//
// 覆盖面（相对既有单测的增量）：
//   - CommandPalette.test 只断言 palette 动作「分发到 handler」（mock handler）；
//   - AppLayout.sidebar-rail.test / SidebarRailToggle.test 直接触发命令 handler
//     或点击按钮，不经命令面板；
//   - 本文件把两段接起来：面板选择「Toggle icon rail」→ runner.dispatch 走真实
//     AppCommandProvider 链 → 注册在 SidebarProvider 上的 railToggle handler
//     → provider rail 状态翻转 → 触发按钮 aria/chevron 同步翻转。
//
// SidebarProvider 用与真实 SidebarStateBridge 相同的受控模式装配（rail 翻转时
// 强制展开侧栏）；桥接 handler 与 AppLayout 里注册的是同一语义（toggle rail）。
// icon rail 的几何/像素形态由快照场景 rail_icon/rail_full 覆盖，这里断言状态层。

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, type AppKeybinding } from "@bb/domain";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { AppCommandProvider, useAppCommandHandler } from "./AppCommandProvider";
import { CommandPalette } from "./CommandPalette";
import { SidebarRailToggle } from "@/components/sidebar/SidebarRailToggle";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";

const MAIN_SURFACE = { all: ["mainSurface" as const], none: [] };

const PALETTE_BINDING: AppKeybinding = {
  command: "palette.open",
  desktopOnly: false,
  shortcut: {
    key: "k",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: false,
  },
  when: MAIN_SURFACE,
};

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

const testState = vi.hoisted(() => ({
  plugins: [] as Array<{
    enabled: boolean;
    hasSettings: boolean;
    icon: string | null;
    id: string;
    name: string | null;
  }>,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: {
        ...defaultAppSettings,
        showKeyboardHints: true,
      },
      keybindings: [
        PALETTE_BINDING,
        RAIL_TOGGLE_BINDING,
        SIDEBAR_TOGGLE_BINDING,
      ],
      defaultKeybindings: [
        PALETTE_BINDING,
        RAIL_TOGGLE_BINDING,
        SIDEBAR_TOGGLE_BINDING,
      ],
    },
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ hasDaemon: false }),
  useLocalHostDaemonAccess: () => ({ accessState: "unavailable" }),
}));

vi.mock("@/lib/app-query-client", () => ({
  appQueryClient: {
    fetchQuery: () => Promise.resolve(testState.plugins),
  },
}));

vi.mock("./ThreadPaletteResults", () => ({
  ThreadPaletteResults: () => null,
}));

/** 真实 SidebarStateBridge 的同构装配：rail 启用时先强制展开侧栏再翻转 rail。 */
function RailHost({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [rail, setRail] = useState(false);
  return (
    <SidebarProvider
      open={open}
      onOpenChange={setOpen}
      rail={rail}
      onRailChange={(nextRail) => {
        if (nextRail) setOpen(true);
        setRail(nextRail);
      }}
    >
      {children}
    </SidebarProvider>
  );
}

/** 注册 sidebar.railToggle handler（与 AppLayout SidebarStateBridge 同语义）。 */
function RailToggleCommandBridge() {
  const { setRail } = useSidebar();
  useAppCommandHandler("sidebar.railToggle", () => {
    setRail((current) => !current);
    return true;
  });
  return null;
}

/** 把 provider 的 rail 状态暴露给断言（避免只靠 aria 间接推断）。 */
function RailProbe() {
  const { rail } = useSidebar();
  return <output data-testid="rail-probe">{String(rail)}</output>;
}

function renderHarness() {
  const result = render(
    <MemoryRouter>
      <AppCommandProvider>
        <RailHost>
          <RailToggleCommandBridge />
          <SidebarRailToggle />
          <RailProbe />
        </RailHost>
        <button type="button" data-testid="origin">
          origin
        </button>
        <CommandPalette threadId={null} projectId={null} />
      </AppCommandProvider>
    </MemoryRouter>,
    {
      wrapper: ({ children }) => (
        <CompactViewportOverrideProvider isCompactViewport={false}>
          {children}
        </CompactViewportOverrideProvider>
      ),
    },
  );
  screen.getByTestId("origin").focus();
  return result;
}

function openPalette(): void {
  fireEvent.keyDown(document.activeElement ?? window, {
    key: "k",
    ctrlKey: true,
    bubbles: true,
  });
}

function pickCommand(title: string): Promise<void> {
  return waitFor(() =>
    expect(
      screen
        .getAllByRole("option")
        .find((option) => option.getAttribute("aria-selected") === "true")
        ?.textContent,
    ).toContain(title),
  ).then(() => {
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  });
}

const railToggleButton = () =>
  screen.getByTestId("sidebar-rail-toggle") as HTMLButtonElement;

const railProbeValue = () =>
  (screen.getByTestId("rail-probe") as HTMLOutputElement).textContent;

afterEach(() => {
  cleanup();
  testState.plugins.length = 0;
  window.localStorage.clear();
});

describe("sidebar.railToggle from the command palette", () => {
  it("enters and exits icon rail with the aria label flipping in sync", async () => {
    renderHarness();

    // 初始：完整侧栏 —— Collapse 标签 + 左箭头
    expect(railProbeValue()).toBe("false");
    expect(railToggleButton().getAttribute("aria-label")).toMatch(
      /^Collapse to icon rail \(/,
    );
    expect(railToggleButton().getAttribute("aria-label")).toContain("\\");
    expect(
      railToggleButton().querySelector('[data-icon="ChevronLeft"]'),
    ).toBeTruthy();

    // 第一轮：从命令面板选「Toggle icon rail」→ 收成 icon rail
    openPalette();
    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: ">Toggle icon rail" },
    });
    await pickCommand("Toggle icon rail");
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());

    await waitFor(() => expect(railProbeValue()).toBe("true"));
    expect(railToggleButton().getAttribute("aria-label")).toMatch(
      /^Expand icon rail \(/,
    );
    expect(railToggleButton().getAttribute("aria-label")).toContain("\\");
    expect(
      railToggleButton().querySelector('[data-icon="ChevronRight"]'),
    ).toBeTruthy();

    // 第二轮：再触发一次 → 退出 icon rail 回完整侧栏
    openPalette();
    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: ">Toggle icon rail" },
    });
    await pickCommand("Toggle icon rail");
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());

    await waitFor(() => expect(railProbeValue()).toBe("false"));
    expect(railToggleButton().getAttribute("aria-label")).toMatch(
      /^Collapse to icon rail \(/,
    );
    expect(
      railToggleButton().querySelector('[data-icon="ChevronLeft"]'),
    ).toBeTruthy();
  });
});
