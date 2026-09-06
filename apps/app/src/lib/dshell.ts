/**
 * DSH / NEXTLoop 皮肤偏好（客户端本地持久化，三态：off / auto / on）。
 *
 * 纯前端实现：只切换 <html> 上的 `.dshell` 类（样式见
 * components/ui/dshell/dshell.css），不触碰主题令牌来源以外的任何机制；
 * 关闭即恢复 bb 原版外观。跨标签页通过 `storage` 事件同步。
 *
 * - off   原版外观（亮色首见默认）：任何外观下都不启用 DSH。
 * - auto  「跟随外观」：暗色外观自动启用 DSH，亮色保持 bb 原版。
 * - on    始终启用 DSH（两种外观都启用）。
 *
 * auto 模式监听 <html> 上 `.dark` 类的变化（MutationObserver），主题切换时
 * 即时生效；历史布尔值（"1"/"true"/"0"/"false"）读取时自动迁移。
 *
 * 首见默认：无存储键的新用户若 OS/主题偏好为暗色，启动即种子写入
 * `bb.dshell.enabled = "auto"`（暗色用户开箱即见 DSH 皮肤）；亮色偏好保持
 * off（opt-in，零副作用），仍可随时在设置里切换。
 */
export const DSHELL_STORAGE_KEY = "bb.dshell.enabled";
// 亮色/无偏好路径的首见默认；暗色首见会在 readStoredMode 里种子为 "auto"。
export const DSHELL_DEFAULT_MODE = "off";

export type DshellMode = "off" | "auto" | "on";

export const DSHELL_PREFERENCE_LABEL = "DSH / NEXTLoop skin";

const MODE_VALUES: readonly DshellMode[] = ["off", "auto", "on"];

function isDshellMode(value: string | null | undefined): value is DshellMode {
  return value !== null && value !== undefined && MODE_VALUES.includes(value as DshellMode);
}

/** OS/主题偏好是否为暗色：html.dark 优先，显式 html.light 直接否定，
 *  两者皆无（如模块初始化早于主题解析）时回退 OS prefers-color-scheme。 */
function isDarkThemePreference(): boolean {
  if (typeof document === "undefined") return false;
  const html = document.documentElement;
  if (html.classList.contains("dark")) return true;
  if (html.classList.contains("light")) return false;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  }
  return false;
}

function readStoredMode(): DshellMode {
  if (typeof localStorage === "undefined") return DSHELL_DEFAULT_MODE;
  const raw = localStorage.getItem(DSHELL_STORAGE_KEY);
  if (raw === null || raw === "") {
    // 新用户（无键）：暗色偏好首见即 auto（跟随外观），种子写入持久化；
    // 亮色偏好维持 off（opt-in），不写盘。
    if (isDarkThemePreference()) {
      try {
        localStorage.setItem(DSHELL_STORAGE_KEY, "auto");
      } catch {
        // 忽略写入失败：本次会话仍按 auto 生效。
      }
      return "auto";
    }
    return DSHELL_DEFAULT_MODE;
  }
  // 迁移旧布尔值："1"/"true" -> on，"0"/"false" -> off
  if (raw === "1" || raw === "true") return "on";
  if (raw === "0" || raw === "false") return "off";
  return isDshellMode(raw) ? raw : DSHELL_DEFAULT_MODE;
}

function persistMode(mode: DshellMode): void {
  try {
    localStorage.setItem(DSHELL_STORAGE_KEY, mode);
  } catch {
    // 隐私模式等场景下忽略写入失败，仅保留本次会话状态。
  }
}

let dshellMode: DshellMode = readStoredMode();
const modeListeners = new Set<() => void>();
const activeListeners = new Set<() => void>();
let lastAppliedActive: boolean | null = null;

export function getDshellMode(): DshellMode {
  return dshellMode;
}

/** 当前是否处于暗色外观（决定 auto 档的有效状态）。 */
export function isDarkAppearance(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

/** auto 档下结合当前外观得到的“当前是否生效”。 */
export function computeDshellActive(): boolean {
  return dshellMode === "on" || (dshellMode === "auto" && isDarkAppearance());
}

export function applyDshellClass(): void {
  if (typeof document === "undefined") return;
  const active = computeDshellActive();
  document.documentElement.classList.toggle("dshell", active);
  lastAppliedActive = active;
}

/** 外观变化（auto 档）后重算：返回是否发生翻转。 */
function refreshActiveFromTheme(): boolean {
  const active = computeDshellActive();
  if (active === lastAppliedActive) return false;
  applyDshellClass();
  return true;
}

function notifyActive(): void {
  for (const listener of activeListeners) listener();
}

export function setDshellMode(mode: DshellMode): void {
  if (!MODE_VALUES.includes(mode)) return;
  if (dshellMode === mode) return;
  dshellMode = mode;
  persistMode(mode);
  const prevActive = lastAppliedActive;
  applyDshellClass();
  for (const listener of modeListeners) listener();
  if (prevActive !== lastAppliedActive) notifyActive();
}

export function isDshellActive(): boolean {
  return computeDshellActive();
}

export function subscribeDshellMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => modeListeners.delete(listener);
}

/** 生效状态订阅：档位或（auto 下）外观变化都会触发。 */
export function subscribeDshellActive(listener: () => void): () => void {
  activeListeners.add(listener);
  const unsubscribeMode = subscribeDshellMode(() => {
    // 档位已由 setDshellMode 统一通知 active。
  });
  return () => {
    activeListeners.delete(listener);
    unsubscribeMode();
  };
}

// 启动时按持久化档位应用一次（main.tsx 在主题初始化后也会调用）。
if (typeof document !== "undefined") {
  applyDshellClass();
}

// auto 档：<html> 上 .dark 变化（主题切换）时即时重算。
if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  const startThemeWatch = () => {
    const observer = new MutationObserver(() => {
      if (dshellMode !== "auto") return;
      if (refreshActiveFromTheme()) notifyActive();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  };
  if (document.documentElement) {
    startThemeWatch();
  } else {
    document.addEventListener("DOMContentLoaded", startThemeWatch, { once: true });
  }
}

// 其他标签页改档位时同步到当前页：档位 + 生效态都对齐（与 setDshellMode 同构，
// 生效态翻转也通知 active 订阅者，否则设置卡等 UI 会停留在旧档位）。
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== DSHELL_STORAGE_KEY) return;
    const raw = event.newValue;
    if (raw === null) return;
    const next = isDshellMode(raw) ? raw : raw === "1" || raw === "true" ? "on" : "off";
    if (next === dshellMode) return;
    const prevActive = lastAppliedActive;
    dshellMode = next;
    applyDshellClass();
    for (const listener of modeListeners) listener();
    if (prevActive !== lastAppliedActive) notifyActive();
  });
}
