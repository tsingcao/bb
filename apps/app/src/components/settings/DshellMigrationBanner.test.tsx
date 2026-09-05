// @vitest-environment jsdom
//
// DshellMigrationBanner 一次性迁移横幅：仅遗留布尔启用值用户可见；
// 关闭按钮与「Open settings」都持久化关闭并即时隐藏；CTA 指向
// /settings/appearance（DSH 三态档位入口）。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { DSHELL_STORAGE_KEY } from "@/lib/dshell";
import { DSHELL_MIGRATION_DISMISSED_KEY } from "@/lib/dshell-migration";
import { DshellMigrationBanner } from "./DshellMigrationBanner";

function seed(enabled: string | null, dismissed: string | null = null) {
  window.localStorage.clear();
  document.documentElement.classList.remove("dshell");
  if (enabled !== null) window.localStorage.setItem(DSHELL_STORAGE_KEY, enabled);
  if (dismissed !== null) {
    window.localStorage.setItem(DSHELL_MIGRATION_DISMISSED_KEY, dismissed);
  }
}

function renderBanner(enabled: string | null, dismissed: string | null = null) {
  seed(enabled, dismissed);
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<DshellMigrationBanner />} />
        <Route path="/settings/:section" element={<div>settings-appearance</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DshellMigrationBanner", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("遗留 '1'：展示横幅与 Open settings 链接", () => {
    renderBanner("1");

    expect(screen.getByTestId("dshell-migration-banner")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Open settings/ }).getAttribute("href")).toBe(
      "/settings/appearance",
    );
    expect(screen.getByRole("button", { name: /Dismiss DSH skin notice/ })).not.toBeNull();
  });

  it("遗留 'true' 也展示", () => {
    renderBanner("true");
    expect(screen.getByTestId("dshell-migration-banner")).not.toBeNull();
  });

  it("已迁移档位 / 无键 → 不展示", () => {
    for (const v of ["on", "off", "auto", null]) {
      renderBanner(v);
      expect(screen.queryByTestId("dshell-migration-banner"), `stored=${v}`).toBeNull();
      cleanup();
    }
  });

  it("点关闭：即时隐藏并持久化关闭标记，重挂载不再出现", () => {
    const { unmount } = renderBanner("1");

    fireEvent.click(screen.getByRole("button", { name: /Dismiss DSH skin notice/ }));

    expect(screen.queryByTestId("dshell-migration-banner")).toBeNull();
    expect(window.localStorage.getItem(DSHELL_MIGRATION_DISMISSED_KEY)).toBe("1");
    // 旧启用值保留（readStoredMode 继续迁移为 on，皮肤行为不变）
    expect(window.localStorage.getItem(DSHELL_STORAGE_KEY)).toBe("1");

    unmount();
    // 模拟一次「真重启」：存储里仍是旧启用值 + 已写关闭标记
    renderBanner("1", "1");
    expect(screen.queryByTestId("dshell-migration-banner")).toBeNull();
  });

  it("点 Open settings：导航到 /settings/appearance 并同时关闭横幅", () => {
    renderBanner("1");

    fireEvent.click(screen.getByRole("link", { name: /Open settings/ }));

    expect(screen.getByText("settings-appearance")).not.toBeNull();
    expect(screen.queryByTestId("dshell-migration-banner")).toBeNull();
    expect(window.localStorage.getItem(DSHELL_MIGRATION_DISMISSED_KEY)).toBe("1");
  });
});
