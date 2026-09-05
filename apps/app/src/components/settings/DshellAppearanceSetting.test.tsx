// @vitest-environment jsdom
//
// DSH 皮肤档位开关的单元测试：开关切换必须调用 dshell.ts 写 localStorage
// 并同步 <html> 上的 .dshell 类；auto 档跟随外观即时翻转；刷新后状态保持。
// dshell.ts 是模块级单例（启动时从 localStorage 读档），因此每个用例用
// vi.resetModules() + 动态 import 模拟一次「全新启动」，刷新持久化用例
// 直接验证新模块实例按持久化档位启动。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DSHELL_STORAGE_KEY } from "@/lib/dshell";

async function loadCard() {
  return (await import("./DshellAppearanceSetting")).DshellAppearanceSetting;
}

function resetBootState() {
  window.localStorage.clear();
  document.documentElement.classList.remove("dshell", "dark", "light");
  // 丢弃已加载模块，下一次 import 按当前 localStorage 重新启动
  vi.resetModules();
}

describe("DshellAppearanceSetting", () => {
  beforeEach(() => {
    resetBootState();
  });

  afterEach(() => {
    cleanup();
  });

  it("默认 off（opt-in）：不启用 dshell，Original 档选中", async () => {
    const Card = await loadCard();
    render(<Card />);

    expect(screen.getByText("Opt-in")).not.toBeNull();
    expect(screen.getByRole("radio", { name: /Original/ }).getAttribute("data-state")).toBe(
      "on",
    );
    expect(document.documentElement.classList.contains("dshell")).toBe(false);
    expect(window.localStorage.getItem(DSHELL_STORAGE_KEY)).toBeNull();
  });

  it("切到 DSH skin 档：写 localStorage 并同步 html.dshell 类", async () => {
    const Card = await loadCard();
    const dshell = await import("@/lib/dshell");
    render(<Card />);

    fireEvent.click(screen.getByRole("radio", { name: /DSH skin/ }));

    expect(window.localStorage.getItem(DSHELL_STORAGE_KEY)).toBe("on");
    expect(dshell.getDshellMode()).toBe("on");
    expect(dshell.isDshellActive()).toBe(true);
    expect(document.documentElement.classList.contains("dshell")).toBe(true);
    expect(screen.getByText("Always")).not.toBeNull();
  });

  it("切回 Original：localStorage 写 off 且移除 html.dshell 类", async () => {
    const Card = await loadCard();
    render(<Card />);

    fireEvent.click(screen.getByRole("radio", { name: /DSH skin/ }));
    expect(document.documentElement.classList.contains("dshell")).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /Original/ }));

    expect(window.localStorage.getItem(DSHELL_STORAGE_KEY)).toBe("off");
    expect(document.documentElement.classList.contains("dshell")).toBe(false);
    expect(screen.getByText("Opt-in")).not.toBeNull();
  });

  it("auto 档跟随外观：暗色启用、亮色停用，翻转实时生效", async () => {
    const Card = await loadCard();
    const dshell = await import("@/lib/dshell");
    document.documentElement.classList.add("dark");
    render(<Card />);

    fireEvent.click(screen.getByRole("radio", { name: /Follow appearance/ }));

    expect(dshell.getDshellMode()).toBe("auto");
    expect(dshell.isDshellActive()).toBe(true);
    expect(document.documentElement.classList.contains("dshell")).toBe(true);
    // 描述行给出实时状态
    expect(screen.getByText(/Active now/)).not.toBeNull();

    // 切到亮色外观 → MutationObserver 即时重算为不启用
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dshell.isDshellActive()).toBe(false);
    expect(document.documentElement.classList.contains("dshell")).toBe(false);
    expect(screen.getByText(/Inactive now/)).not.toBeNull();
  });

  it("卡片内联说明：展示三档含义（Original / Follow appearance / DSH skin）", async () => {
    const Card = await loadCard();
    render(<Card />);

    const help = screen.getByTestId("dshell-mode-help");
    const text = help.textContent ?? "";
    expect(text).toContain("Original");
    expect(text).toContain("bb's original look in light and dark");
    expect(text).toContain("Follow appearance");
    expect(text).toContain("DSH in dark; bb original in light");
    expect(text).toContain("DSH skin");
    expect(text).toContain("DSH in light and dark");
  });

  it("刷新后状态保持：新模块实例按 localStorage 持久化档位启动", async () => {
    const Card = await loadCard();
    render(<Card />);
    fireEvent.click(screen.getByRole("radio", { name: /DSH skin/ }));
    expect(window.localStorage.getItem(DSHELL_STORAGE_KEY)).toBe("on");

    // 模拟整页刷新：清掉类（旧实例遗留）→ 全新模块实例按持久化档位启动
    document.documentElement.classList.remove("dshell");
    vi.resetModules();
    const fresh = await import("@/lib/dshell");

    expect(fresh.getDshellMode()).toBe("on");
    expect(fresh.isDshellActive()).toBe(true);
    // 新实例启动时的 applyDshellClass() 重新挂上类
    expect(document.documentElement.classList.contains("dshell")).toBe(true);
  });
});
