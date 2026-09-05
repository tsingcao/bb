// @vitest-environment jsdom
//
// lib/dshell.ts 的 opt-in 契约单测（模块级直测，不经 UI 组件）：
//   1. 默认关闭（opt-in）——亮色偏好首访 off、零副作用；暗色偏好首访 seed auto；
//   2. 陈旧值迁移——历史布尔 "1"/"true"→on、"0"/"false"→off，不合法值回退 off；
//   3. 切换写盘——setDshellMode 写 bb.dshell.enabled 并同步 html.dshell 类，
//      同档 no-op 与非法档位拒绝写盘；
//   4. 档位解析——存储的 on/off/auto 启动即落到对应档位；
//   5. 监听通知——mode/active 订阅在档位变更与生效态翻转时收到通知；
//   6. auto 跟随外观——<html> 的 .dark 类变化经 MutationObserver 即时翻转。
// dshell.ts 是模块级单例（import 时读 localStorage 并 applyDshellClass），
// 每个用例 vi.resetModules() + 动态 import 模拟一次全新启动。
//
// 组件层（DshellAppearanceSetting.test.tsx）已覆盖「设置卡点击 → 写盘 +
// 类同步 + 刷新保持 + auto 跟随外观」；本文件锁定的是模块本身契约。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DshellMode } from "./dshell";

const KEY = "bb.dshell.enabled";

/** 清空状态后按指定存储值「全新启动」一次 dshell 模块。 */
async function boot(stored: string | null) {
  window.localStorage.clear();
  document.documentElement.classList.remove("dshell", "dark", "light");
  if (stored !== null) window.localStorage.setItem(KEY, stored);
  vi.resetModules();
  return await import("./dshell");
}

/** 测试环境的 matchMedia 桩（setup.ts 默认 matches:false=亮色）。 */
const SETUP_MATCH_MEDIA = window.matchMedia;

function stubMatchMedia(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: dark,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function restoreMatchMedia() {
  window.matchMedia = SETUP_MATCH_MEDIA;
}

interface BootEnv {
  stored?: string | null;
  darkClass?: boolean;
  lightClass?: boolean;
  osDark?: boolean;
}

/** 带环境变量（html 主题类 / OS prefers-color-scheme）的「全新启动」。 */
async function bootEnv(env: BootEnv = {}) {
  window.localStorage.clear();
  document.documentElement.classList.remove("dshell", "dark", "light");
  if (env.darkClass) document.documentElement.classList.add("dark");
  if (env.lightClass) document.documentElement.classList.add("light");
  if (env.osDark !== undefined) stubMatchMedia(env.osDark);
  if (env.stored != null) window.localStorage.setItem(KEY, env.stored);
  vi.resetModules();
  return await import("./dshell");
}

describe("lib/dshell opt-in 契约", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dshell", "dark", "light");
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreMatchMedia();
  });

  it("默认 off（亮色偏好）：无键启动为原版，首访零副作用（不写盘）", async () => {
    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    const mod = await boot(null);

    expect(mod.DSHELL_STORAGE_KEY).toBe(KEY);
    expect(mod.DSHELL_DEFAULT_MODE).toBe("off");
    expect(mod.getDshellMode()).toBe("off");
    expect(mod.isDshellActive()).toBe(false);
    expect(document.documentElement.classList.contains("dshell")).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    // opt-in：启动/读取过程不得产生任何写入副作用
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("空键与非法值也启动为原版 off", async () => {
    for (const stale of ["", "banana", "enabled", "OFF"]) {
      const mod = await boot(stale);
      expect(mod.getDshellMode(), `stale=${JSON.stringify(stale)}`).toBe("off");
      expect(mod.isDshellActive()).toBe(false);
      expect(document.documentElement.classList.contains("dshell")).toBe(false);
    }
  });

  it("陈旧布尔值迁移：1/true → on，0/false → off（启动即原版）", async () => {
    const legacyOn = await boot("1");
    expect(legacyOn.getDshellMode()).toBe("on");
    expect(legacyOn.isDshellActive()).toBe(true);
    expect(document.documentElement.classList.contains("dshell")).toBe(true);

    const trueOn = await boot("true");
    expect(trueOn.getDshellMode()).toBe("on");
    expect(document.documentElement.classList.contains("dshell")).toBe(true);

    for (const v of ["0", "false"]) {
      const mod = await boot(v);
      expect(mod.getDshellMode(), `stale=${v}`).toBe("off");
      expect(document.documentElement.classList.contains("dshell")).toBe(false);
    }
  });

  it("切换到 on：写 bb.dshell.enabled 并同步 html.dshell 类", async () => {
    const mod = await boot(null);

    mod.setDshellMode("on");

    expect(window.localStorage.getItem(KEY)).toBe("on");
    expect(mod.getDshellMode()).toBe("on");
    expect(mod.isDshellActive()).toBe(true);
    expect(document.documentElement.classList.contains("dshell")).toBe(true);
  });

  it("切换 off/auto 同样持久化对应档位", async () => {
    const mod = await boot("on");

    mod.setDshellMode("off");
    expect(window.localStorage.getItem(KEY)).toBe("off");
    expect(document.documentElement.classList.contains("dshell")).toBe(false);

    mod.setDshellMode("auto");
    expect(window.localStorage.getItem(KEY)).toBe("auto");
    expect(mod.getDshellMode()).toBe("auto");
    // 无 .dark 外观下 auto 档不生效
    expect(mod.isDshellActive()).toBe(false);
  });

  it("同档 no-op 与非法档位拒绝写盘", async () => {
    const mod = await boot("auto");
    const setSpy = vi.spyOn(Storage.prototype, "setItem");

    mod.setDshellMode("auto");
    expect(setSpy).not.toHaveBeenCalled();

    mod.setDshellMode("banana" as DshellMode);
    expect(setSpy).not.toHaveBeenCalled();
    expect(mod.getDshellMode()).toBe("auto");
    expect(window.localStorage.getItem(KEY)).toBe("auto");
  });

  it("档位解析：存储的 on/auto/off 启动即落到对应档位", async () => {
    const on = await boot("on");
    expect(on.getDshellMode()).toBe("on");
    expect(on.isDshellActive()).toBe(true);
    expect(document.documentElement.classList.contains("dshell")).toBe(true);

    const off = await boot("off");
    expect(off.getDshellMode()).toBe("off");
    expect(off.isDshellActive()).toBe(false);
    expect(document.documentElement.classList.contains("dshell")).toBe(false);

    const auto = await boot("auto");
    expect(auto.getDshellMode()).toBe("auto");
    // 无 .dark 外观下 auto 不生效
    expect(auto.isDshellActive()).toBe(false);
    expect(document.documentElement.classList.contains("dshell")).toBe(false);
  });

  it("mode 监听：档位变更时通知订阅者，退订后不再通知", async () => {
    const mod = await boot(null);
    const listener = vi.fn();
    const unsubscribe = mod.subscribeDshellMode(listener);

    mod.setDshellMode("on");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    mod.setDshellMode("off");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("active 监听：仅生效态翻转时通知（off→on 翻转，auto→off 不翻转）", async () => {
    const mod = await boot(null); // off，不生效
    const listener = vi.fn();
    const unsubscribe = mod.subscribeDshellActive(listener);

    // off(无效) → on(生效)：翻转 → 通知
    mod.setDshellMode("on");
    expect(listener).toHaveBeenCalledTimes(1);

    // on(生效) → auto(亮色无效)：翻转 → 通知
    mod.setDshellMode("auto");
    expect(listener).toHaveBeenCalledTimes(2);

    // auto(无效) → off(无效)：未翻转 → 不通知
    unsubscribe();
    listener.mockClear();
    const sub2 = mod.subscribeDshellActive(listener);
    mod.setDshellMode("off");
    expect(listener).not.toHaveBeenCalled();
    sub2();
  });

  it("无键 + OS 暗色（prefers-color-scheme: dark）：首见 seed bb.dshell.enabled=auto", async () => {
    const mod = await bootEnv({ osDark: true });

    expect(window.localStorage.getItem(KEY)).toBe("auto");
    expect(mod.getDshellMode()).toBe("auto");
    // 尚无 .dark 类（主题未解析）时不生效、不上类
    expect(mod.isDshellActive()).toBe(false);
    expect(document.documentElement.classList.contains("dshell")).toBe(false);

    // 主题解析为暗色（html.dark）→ observer 翻转生效并通知
    const listener = vi.fn();
    mod.subscribeDshellActive(listener);
    document.documentElement.classList.add("dark");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mod.isDshellActive()).toBe(true);
    expect(document.documentElement.classList.contains("dshell")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("无键 + html.dark 已解析（无 matchMedia 也可）：同样 seed auto 且立即生效", async () => {
    const mod = await bootEnv({ darkClass: true });

    expect(window.localStorage.getItem(KEY)).toBe("auto");
    expect(mod.getDshellMode()).toBe("auto");
    expect(mod.isDshellActive()).toBe(true);
    expect(document.documentElement.classList.contains("dshell")).toBe(true);
  });

  it("无键 + 显式 html.light（即使 OS 暗色）：不 seed，保持 off 且不写盘", async () => {
    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    const mod = await bootEnv({ lightClass: true, osDark: true });

    expect(mod.getDshellMode()).toBe("off");
    expect(mod.isDshellActive()).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("auto 档跟随 .dark 外观翻转（MutationObserver），并通知 active 订阅者", async () => {
    const mod = await boot("auto");
    const listener = vi.fn();
    mod.subscribeDshellActive(listener);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    expect(mod.isDshellActive()).toBe(false);
    expect(document.documentElement.classList.contains("dshell")).toBe(false);

    // 切到暗色 → 即时生效 + 类同步 + 通知
    document.documentElement.classList.add("dark");
    await tick();
    expect(mod.isDshellActive()).toBe(true);
    expect(document.documentElement.classList.contains("dshell")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    // 切回亮色 → 即时停用 + 类移除 + 通知
    document.documentElement.classList.remove("dark");
    await tick();
    expect(mod.isDshellActive()).toBe(false);
    expect(document.documentElement.classList.contains("dshell")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
