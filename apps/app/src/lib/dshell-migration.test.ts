// @vitest-environment jsdom
//
// dshell-migration.ts 的一次性迁移横幅逻辑：仅旧布尔启用值（"1"/"true"）
// 且未被关闭过时展示；关闭后写 bb.dshell.migration.dismissed 永久隐藏；
// 已迁移/关闭皮肤的用户一律不展示。

import { afterEach, describe, expect, it, vi } from "vitest";
import { DSHELL_STORAGE_KEY } from "./dshell";
import {
  DSHELL_MIGRATION_DISMISSED_KEY,
  dismissDshellMigrationBanner,
  isLegacyEnabledValue,
  shouldShowDshellMigrationBanner,
} from "./dshell-migration";

function seed(enabled: string | null, dismissed: string | null = null) {
  window.localStorage.clear();
  if (enabled !== null) window.localStorage.setItem(DSHELL_STORAGE_KEY, enabled);
  if (dismissed !== null) {
    window.localStorage.setItem(DSHELL_MIGRATION_DISMISSED_KEY, dismissed);
  }
}

describe("dshell-migration 一次性迁移横幅", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("旧布尔启用值识别：1/true 为遗留启用值", () => {
    expect(isLegacyEnabledValue("1")).toBe(true);
    expect(isLegacyEnabledValue("true")).toBe(true);
    expect(isLegacyEnabledValue("0")).toBe(false);
    expect(isLegacyEnabledValue("false")).toBe(false);
    expect(isLegacyEnabledValue("on")).toBe(false);
    expect(isLegacyEnabledValue("off")).toBe(false);
    expect(isLegacyEnabledValue(null)).toBe(false);
  });

  it("遗留 '1'/'true' 且未关闭 → 展示", () => {
    seed("1");
    expect(shouldShowDshellMigrationBanner()).toBe(true);
    seed("true");
    expect(shouldShowDshellMigrationBanner()).toBe(true);
  });

  it("无键 / 已迁移为新档位 → 不展示", () => {
    seed(null);
    expect(shouldShowDshellMigrationBanner()).toBe(false);
    for (const v of ["on", "off", "auto", "0", "false", ""]) {
      seed(v);
      expect(shouldShowDshellMigrationBanner(), `stored=${v}`).toBe(false);
    }
  });

  it("已关闭（1/true）→ 永久不展示", () => {
    seed("1", "1");
    expect(shouldShowDshellMigrationBanner()).toBe(false);
    seed("1", "true");
    expect(shouldShowDshellMigrationBanner()).toBe(false);
  });

  it("dismiss 写持久化标记，之后不再展示（存储中的旧启用值保留）", () => {
    seed("1");
    dismissDshellMigrationBanner();

    expect(window.localStorage.getItem(DSHELL_MIGRATION_DISMISSED_KEY)).toBe("1");
    expect(window.localStorage.getItem(DSHELL_STORAGE_KEY)).toBe("1");
    expect(shouldShowDshellMigrationBanner()).toBe(false);
  });
});
