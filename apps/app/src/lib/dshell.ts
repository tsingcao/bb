/**
 * DSH / NEXTLoop 皮肤偏好（客户端本地持久化）。
 *
 * 纯前端开关：只切换 <html> 上的 `.dshell` 类（样式见
 * components/ui/dshell/dshell.css），不触碰主题令牌来源以外的任何机制；
 * 关闭即恢复 bb 原版外观。跨标签页通过 `storage` 事件同步。
 */
export const DSHELL_ENABLED_STORAGE_KEY = "bb.dshell.enabled";
export const DSHELL_DEFAULT_ENABLED = true;

export const DSHELL_PREFERENCE_LABEL = "DSH / NEXTLoop skin";

function readStoredValue(): boolean {
  if (typeof localStorage === "undefined") return DSHELL_DEFAULT_ENABLED;
  const raw = localStorage.getItem(DSHELL_ENABLED_STORAGE_KEY);
  if (raw === null) return DSHELL_DEFAULT_ENABLED;
  return raw === "1" || raw === "true";
}

let dshellEnabled = readStoredValue();
const dshellListeners = new Set<() => void>();

export function isDshellEnabled(): boolean {
  return dshellEnabled;
}

export function applyDshellClass(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dshell", dshellEnabled);
}

export function setDshellEnabled(enabled: boolean): void {
  if (dshellEnabled === enabled) return;
  dshellEnabled = enabled;
  try {
    localStorage.setItem(DSHELL_ENABLED_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // 隐私模式等场景下忽略写入失败，仅保留本次会话状态。
  }
  applyDshellClass();
  for (const listener of dshellListeners) listener();
}

export function subscribeDshellEnabled(listener: () => void): () => void {
  dshellListeners.add(listener);
  return () => dshellListeners.delete(listener);
}

// 其他标签页改偏好时同步到当前页。
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== DSHELL_ENABLED_STORAGE_KEY) return;
    const next = event.newValue === "1" || event.newValue === "true";
    if (next === dshellEnabled) return;
    dshellEnabled = next;
    applyDshellClass();
    for (const listener of dshellListeners) listener();
  });
}
