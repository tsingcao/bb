// @vitest-environment jsdom
//
// 端到端断言：从命令面板（CommandPalette，真实 UI + 真实 AppCommandProvider 分发链）
// 触发 sidebar.toggle → 侧栏展开/收起，SidebarTrigger 的 aria-expanded 同步翻转。
//
// 覆盖面（相对既有单测的增量）：
//   - CommandPalette.test 只断言 palette 动作「分发到 handler」（mock handler）；
//   - AppLayout.sidebar-rail.test 直接调 handler 闭包；AppLayout.sidebar-rail-keydown
//     走键盘事件级（⌘\）——都不经命令面板 UI；
//   - 本文件与 CommandPalette.railToggle.test 对称：面板选择「Toggle sidebar」→
//     runner.dispatch 走真实 AppCommandProvider 链 → SidebarToggleCommandBridge
//     上注册的 sidebar.toggle handler → provider open 状态翻转 → SidebarTrigger
//     aria-expanded 同步翻转；并覆盖 rail 流的完整命令面：rail 开着时经面板收起
//     侧栏不解除 rail（单向不变式），与 AppLayout 桥接语义一致。
//
// SidebarProvider 用与真实 AppLayout SidebarStateBridge 相同的受控模式装配
// （rail 启用强制展开侧栏；sidebar.toggle 只动 open 原子，不碰 rail）。

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
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

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
        SIDEBAR_TOGGLE_BINDING,
        RAIL_TOGGLE_BINDING,
      ],
      defaultKeybindings: [
        PALETTE_BINDING,
        SIDEBAR_TOGGLE_BINDING,
        RAIL_TOGGLE_BINDING,
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

/** 真实 AppLayout SidebarStateBridge 的同构装配：rail 启用时先强制展开侧栏。 */
function SidebarHost({
  children,
  initialOpen = true,
  initialRail = false,
}: {
  children: ReactNode;
  initialOpen?: boolean;
  initialRail?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [rail, setRail] = useState(initialRail);
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

/** 注册 sidebar.toggle handler（与 AppLayout 同语义：只动 open 原子，不碰 rail）。 */
function SidebarToggleCommandBridge() {
  const { open, setOpen } = useSidebar();
  useAppCommandHandler("sidebar.toggle", () => {
    setOpen(!open);
    return true;
  });
  return null;
}

/** 把 provider 的 open/rail 状态暴露给断言（避免只靠 aria 间接推断）。 */
function StateProbe() {
  const { open, rail } = useSidebar();
  return (
    <output data-testid="state-probe">
      open:{String(open)} rail:{String(rail)}
    </output>
  );
}

function renderHarness(opts?: { initialRail?: boolean }) {
  const result = render(
    <MemoryRouter>
      <AppCommandProvider>
        <SidebarHost initialRail={opts?.initialRail}>
          <SidebarToggleCommandBridge />
          <SidebarTrigger />
          <StateProbe />
        </SidebarHost>
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

// SidebarTrigger 无 testid：按 sr-only 名称定位（data-sidebar="trigger" 的元素）
const sidebarTrigger = () =>
  screen.getByRole("button", { name: "Toggle Sidebar" }) as HTMLButtonElement;

const probeValue = () =>
  (screen.getByTestId("state-probe") as HTMLOutputElement).textContent;

afterEach(() => {
  cleanup();
  testState.plugins.length = 0;
  window.localStorage.clear();
});

describe("sidebar.toggle from the command palette", () => {
  it("collapses and re-expands the sidebar with aria-expanded flipping in sync", async () => {
    renderHarness();

    // 初始：侧栏展开 —— aria-expanded=true
    expect(probeValue()).toBe("open:true rail:false");
    expect(sidebarTrigger().getAttribute("aria-expanded")).toBe("true");

    // 第一轮：面板选「Toggle sidebar」→ 收起
    openPalette();
    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: ">Toggle sidebar" },
    });
    await pickCommand("Toggle sidebar");
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());

    await waitFor(() =>
      expect(probeValue()).toBe("open:false rail:false"),
    );
    expect(sidebarTrigger().getAttribute("aria-expanded")).toBe("false");

    // 第二轮：再触发一次 → 重新展开
    openPalette();
    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: ">Toggle sidebar" },
    });
    await pickCommand("Toggle sidebar");
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());

    await waitFor(() => expect(probeValue()).toBe("open:true rail:false"));
    expect(sidebarTrigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("renders the Toggle sidebar row with group and ⌘\\ pill (no Shift), and click activates it", async () => {
    renderHarness();
    expect(probeValue()).toBe("open:true rail:false");

    openPalette();
    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: ">Toggle sidebar" },
    });

    const row = await waitFor(() => {
      const found = screen
        .getAllByRole("option")
        .find((option) => option.textContent?.includes("Toggle sidebar"));
      expect(found).toBeTruthy();
      return found;
    });

    // 行内容可见性：标题 + 分组 + 快捷键药丸（⌘\ —— 与 railToggle 的 ⌘⇧\ 区分）
    expect(row!.textContent).toContain("Toggle sidebar");
    expect(row!.textContent).toContain("Window and layout");
    const pill = row!.querySelector("kbd");
    expect(pill).toBeTruthy();
    expect(pill!.textContent).toContain("\\");
    // 平台 mod 键标签（⌘/Ctrl/Cmd/Mod 任一）；与 railToggle 的 ⌘⇧\ 区分点是无 Shift
    expect(pill!.textContent).toMatch(/⌘|Ctrl|Cmd|Mod/);
    expect(pill!.textContent).not.toContain("Shift");

    // 指针点击行本身（与 Enter 路径对称）
    fireEvent.click(row!);
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    await waitFor(() =>
      expect(probeValue()).toBe("open:false rail:false"),
    );
    expect(sidebarTrigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("closing the sidebar via the palette does not clear an active rail (one-way rule)", async () => {
    renderHarness({ initialRail: true });
    expect(probeValue()).toBe("open:true rail:true");

    openPalette();
    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: ">Toggle sidebar" },
    });
    await pickCommand("Toggle sidebar");
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());

    // 侧栏收起，但 rail 原子保持（sidebar.toggle 只动 open —— 与 AppLayout 单向不变式一致）
    await waitFor(() => expect(probeValue()).toBe("open:false rail:true"));
    expect(sidebarTrigger().getAttribute("aria-expanded")).toBe("false");
  });
});