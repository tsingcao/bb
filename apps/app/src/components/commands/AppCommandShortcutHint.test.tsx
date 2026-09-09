// @vitest-environment jsdom
//
// AppCommandShortcutHint 的 modifier-hold 事件级集成：不 mock AppCommandProvider，
// 用真实 keydown/keyup 事件驱动 provider 的 hold 状态机（SHORTCUT_HINT_HOLD_DELAY_MS
// = 700ms），断言药丸出现/消失与 showKeyboardHints=false 下的抑制。
//
// 覆盖面（相对既有单测的增量）：
//   - AppCommandProvider.test 只断言 provider 的 held 状态翻转（ModifierState 文本）；
//   - 消费端（AppCommandShortcutHint）与 provider 的接缝（context 值 → pill 渲染）
//     由本文件覆盖：hold 未满 → 无 pill；hold 满 → pill；keyup → pill 消失；
//     hints 关闭 → 永不出现（即使 hold 满）。
//   - chord 取消路径（hold 中按其它键）在 provider 层已覆盖，消费端同样断言一次。

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, type AppCommandId } from "@bb/domain";
import { AppCommandProvider, useAppCommandShortcut } from "./AppCommandProvider";
import { AppCommandShortcutHint } from "./AppCommandShortcutHint";

const testState = vi.hoisted(() => ({
  showKeyboardHints: true,
  keybindings: [
    {
      command: "sidebar.railToggle" as const,
      desktopOnly: false,
      shortcut: {
        key: "\\",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      },
      when: { all: ["mainSurface" as const], none: [] },
    },
  ],
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: {
        ...defaultAppSettings,
        showKeyboardHints: testState.showKeyboardHints,
      },
      keybindings: testState.keybindings,
    },
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

// AppCommandShortcutHint 的 props 是 shortcut presentation（非 command id）；
// 用真实 provider 的 useAppCommandShortcut 取 presentation 再传给 hint。
function ProviderHintHost({ command }: { command: AppCommandId }) {
  const shortcut = useAppCommandShortcut(command);
  return <AppCommandShortcutHint shortcut={shortcut} />;
}

function renderHint() {
  return render(
    <MemoryRouter>
      <AppCommandProvider>
        <ProviderHintHost command="sidebar.railToggle" />
      </AppCommandProvider>
    </MemoryRouter>,
  );
}

// 平台：jsdom navigator.platform 为空 → 非 Mac → 修饰键是 Control。
function holdModifier() {
  fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
}

function releaseModifier() {
  fireEvent.keyUp(window, { key: "Control" });
}

describe("AppCommandShortcutHint modifier-hold integration", () => {
  beforeEach(() => {
    testState.showKeyboardHints = true;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the pill only after the hold delay and hides it on keyup", () => {
    vi.useFakeTimers();
    renderHint();

    // 未按住：无 pill
    expect(screen.queryByText("Ctrl + Shift + \\")).toBeNull();

    // 按住但未满 hold 延迟：仍无 pill
    act(() => {
      holdModifier();
    });
    act(() => {
      vi.advanceTimersByTime(699);
    });
    expect(screen.queryByText("Ctrl + Shift + \\")).toBeNull();

    // 满 700ms：pill 出现
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText("Ctrl + Shift + \\")).toBeDefined();

    // keyup：pill 消失
    act(() => {
      releaseModifier();
    });
    expect(screen.queryByText("Ctrl + Shift + \\")).toBeNull();
  });

  it("never shows the pill when showKeyboardHints is off, even after a long hold", () => {
    vi.useFakeTimers();
    testState.showKeyboardHints = false;
    renderHint();

    act(() => {
      holdModifier();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("Ctrl + Shift + \\")).toBeNull();

    // 松开后再次按住同样无效（hints 关闭时 hold 状态机根本不启动）
    act(() => {
      releaseModifier();
    });
    act(() => {
      holdModifier();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("Ctrl + Shift + \\")).toBeNull();
  });

  it("hides the pill when the hold turns into a chord (another key joins)", () => {
    vi.useFakeTimers();
    renderHint();

    act(() => {
      holdModifier();
    });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(screen.getByText("Ctrl + Shift + \\")).toBeDefined();

    // hold 中按 Shift（组成组合键）→ hold 取消，pill 消失
    act(() => {
      fireEvent.keyDown(window, { key: "Shift", ctrlKey: true, shiftKey: true });
    });
    expect(screen.queryByText("Ctrl + Shift + \\")).toBeNull();

    // 释放后重新单独按住 → hold 重新计时，pill 回来
    act(() => {
      fireEvent.keyUp(window, { key: "Shift" });
      releaseModifier();
      holdModifier();
    });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(screen.getByText("Ctrl + Shift + \\")).toBeDefined();
  });

  it("clears the pill on window blur without keyup", () => {
    vi.useFakeTimers();
    renderHint();

    act(() => {
      holdModifier();
    });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(screen.getByText("Ctrl + Shift + \\")).toBeDefined();

    act(() => {
      fireEvent.blur(window);
    });
    expect(screen.queryByText("Ctrl + Shift + \\")).toBeNull();
  });
});
