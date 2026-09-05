/**
 * DSH 皮肤「旧布尔启用值」的一次性迁移提示。
 *
 * 背景：opt-in 三态（off/auto/on）落地前，旧版本用布尔值
 * bb.dshell.enabled = "1"/"true" 表示启用。readStoredMode 会在读取时
 * 把旧值迁移为 on，但存储里仍是旧值——这些用户可能不知道新增的
 * Settings 入口（Original/Auto/Always 三态），因此给他们在启动时展示
 * 一次可关闭的横幅，引导到 /settings/appearance。
 *
 * 契约：仅当存储里仍是旧布尔启用值（"1"/"true"）且未被关闭过时展示；
 * 用户点关闭或点开设置入口后写入 bb.dshell.migration.dismissed，永久不再展示。
 */
import { DSHELL_STORAGE_KEY } from "./dshell";

export const DSHELL_MIGRATION_DISMISSED_KEY = "bb.dshell.migration.dismissed";

/** 旧版布尔启用值（迁移前遗留的存储形态）。 */
export function isLegacyEnabledValue(raw: string | null): boolean {
  return raw === "1" || raw === "true";
}

/** 是否应展示一次性迁移横幅（本地读，纯函数，无副作用）。 */
export function shouldShowDshellMigrationBanner(): boolean {
  if (typeof localStorage === "undefined") return false;
  if (!isLegacyEnabledValue(localStorage.getItem(DSHELL_STORAGE_KEY))) {
    return false;
  }
  // 已关闭过（"1"/"true"）则永久不展示
  return !isLegacyEnabledValue(localStorage.getItem(DSHELL_MIGRATION_DISMISSED_KEY));
}

/** 持久化关闭标记（隐私模式等写入失败场景忽略，仅本次会话隐藏）。 */
export function dismissDshellMigrationBanner(): void {
  try {
    localStorage.setItem(DSHELL_MIGRATION_DISMISSED_KEY, "1");
  } catch {
    // 忽略写入失败，横幅下次启动可能再次出现（可接受）。
  }
}
