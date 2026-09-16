// @vitest-environment jsdom
//
// lib/dshell.ts 的 opt-in 契约单测（模块级直测，不经 UI 组件）：
//   1. 默认关闭（opt-in）——亮色偏好首访 off、零副作用；暗色偏好首访 seed auto；
//   2. 陈旧值迁移——历史布尔 "1"/"true"→on、"0"/"false"→off，不合法值回退 off；
//   3. 切换写盘——setDshellMode 写 bb.dshell.enabled 并同步 html.dshell 类，
//      同档 no-op 与非法档位拒绝写盘；
//   4. 档位解析——存储的 on/off/auto 启动即落到对应档位；
//   5. 监听通知——mode/active 订阅在档位变更与生效态翻转时收到通知；
//   6. auto 跟随外观——<html> 的 .dark 类变化经 MutationObserver 即时翻转，
//      纯 DOM 反应：翻转/通知全程不写 localStorage；
//   7. 跨标签页同步——storage 事件把其它标签页的档位/生效态同步过来，
//      旧布尔值（"1"/"0"）同样在事件路径迁移。
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

  it("启动遇未知字符串（如 maybe）回退 off，与 storage 事件路径一致，不触发暗色 auto 种子（边界）", async () => {
    // 与 storage 事件未知值测试对偶：启动路径的对称风险是未知值被误判为「无键」，
    // 在暗色环境下错误触发 auto 种子。断言三件事：
    // ① 亮色环境下回退 off（与 storage 路径同语义）；
    // ② 暗色环境下仍回退 off 而非 auto —— 未知值 ≠ 无键，auto 只能由合法
    //    字符串或真正的无键首见产生；
    // ③ 存储值不被改写（回退是读时行为，非写时修正，与 opt-in 零副作用一致）。
    for (const unknown of ["maybe", "banana", "OFF", "truee"]) {
      const lightMod = await boot(unknown);
      expect(lightMod.getDshellMode(), `light unknown=${JSON.stringify(unknown)}`).toBe("off");
      expect(lightMod.isDshellActive()).toBe(false);
      expect(window.localStorage.getItem(KEY), `light 未改写 ${JSON.stringify(unknown)}`).toBe(unknown);

      const darkMod = await bootEnv({ stored: unknown, darkClass: true });
      expect(darkMod.getDshellMode(), `dark unknown=${JSON.stringify(unknown)}`).toBe("off");
      expect(darkMod.getDshellMode()).not.toBe("auto");
      expect(darkMod.isDshellActive()).toBe(false);
      expect(document.documentElement.classList.contains("dshell")).toBe(false);
      expect(window.localStorage.getItem(KEY), `dark 未改写且未种子 ${JSON.stringify(unknown)}`).toBe(unknown);
    }

    // 对照组：真正的无键 + 暗色才产生 auto 种子（证明上面的 off 非环境偶然）。
    const seedMod = await bootEnv({ darkClass: true });
    expect(seedMod.getDshellMode()).toBe("auto");
    expect(window.localStorage.getItem(KEY)).toBe("auto");

    // 对照组：合法 "auto" 启动即 auto，未被回退路径吞掉。
    const autoMod = await boot("auto");
    expect(autoMod.getDshellMode()).toBe("auto");
  });

  it("档位解析严格大小写敏感：'ON'/'Auto'/'OFF' 是未知值，启动与 storage 路径一致回退 off（决定锁定）", async () => {
    // 设计决定（锁定为契约，勿改）：解析**不做**大小写归一化。
    // 理由：① 唯一写入方 setDshellMode 受 DshellMode 类型约束、永远写小写
    //    字面量，不存在大写来源；手动改 localStorage 属越出契约的操作，
    //    宽容解析会把笔误（"Auto "尾空格、"ONN"）之外的东西也吞进有效值域，
    //    反而扩大歧义（如 "On" 该算 on 还是未知？）；② 三态值域与旧布尔
    //    迁移共用一个回退链，加 toLowerCase 会把 "TRUE"（旧布尔大写）也激活
    //    为 on，改变已发布的迁移语义；③ 与主题类（html.dark）同风格 ——
    //    DOM class 同样大小写敏感，宽容解析制造不一致心智模型。
    // 若未来真要归一化，必须先改此测试 + storage 未知值测试 + 契约文档三处。
    for (const cased of ["ON", "Auto", "OFF", "On", "AUTO"]) {
      const lightMod = await boot(cased);
      expect(lightMod.getDshellMode(), `light cased=${JSON.stringify(cased)}`).toBe("off");
      expect(lightMod.isDshellActive()).toBe(false);

      const darkMod = await bootEnv({ stored: cased, darkClass: true });
      expect(darkMod.getDshellMode(), `dark cased=${JSON.stringify(cased)}`).toBe("off");
      expect(darkMod.getDshellMode()).not.toBe("auto");
    }

    // storage 路径对称：大写变体同走未知值回退，不触发档位翻转。
    // （storageEventFromOtherTab 是 storage describe 块内的局部辅助，此处用
    //  同构的内联 dispatch —— 非本键/同档 no-op 语义已在另一 describe 锁定。）
    const mod = await boot("on");
    const modeListener = vi.fn();
    mod.subscribeDshellMode(modeListener);
    for (const cased of ["ON", "Auto", "OFF"]) {
      window.dispatchEvent(
        new StorageEvent("storage", { key: KEY, newValue: cased }),
      );
      expect(mod.getDshellMode(), `storage cased=${JSON.stringify(cased)}`).toBe("off");
    }
    expect(modeListener).toHaveBeenCalledTimes(1); // on→off 一次，其余同档 no-op
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

  it("auto 档跟随 .dark 是纯 DOM 反应：翻转/通知全程不写 localStorage", async () => {
    // boot("auto") 完成后再装 spy：启动时的 seed 写入不计入，
    // 之后任何 setItem/removeItem 都会被捕获。
    const mod = await boot("auto");
    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem");
    const listener = vi.fn();
    mod.subscribeDshellActive(listener);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    // 切到暗色：生效 + 类同步 + 通知，但存储值保持 auto 且零写入
    document.documentElement.classList.add("dark");
    await tick();
    expect(mod.isDshellActive()).toBe(true);
    expect(document.documentElement.classList.contains("dshell")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(KEY)).toBe("auto");
    expect(setSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();

    // 切回亮色：停用 + 类移除 + 再通知，仍零写入
    document.documentElement.classList.remove("dark");
    await tick();
    expect(mod.isDshellActive()).toBe(false);
    expect(document.documentElement.classList.contains("dshell")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(KEY)).toBe("auto");
    expect(setSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });
});

describe("lib/dshell 跨标签页同步（storage 事件）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dshell", "dark", "light");
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreMatchMedia();
  });

  /** 模拟其它标签页写入 bb.dshell.enabled 后当前页收到的 storage 事件。 */
  function storageEventFromOtherTab(newValue: string | null, key = KEY) {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
  }

  it("其它标签页改档位：档位/类/生效态同步，mode 与 active 订阅者都收到通知", async () => {
    const mod = await boot("off");
    const modeListener = vi.fn();
    const activeListener = vi.fn();
    mod.subscribeDshellMode(modeListener);
    mod.subscribeDshellActive(activeListener);

    expect(mod.getDshellMode()).toBe("off");
    expect(mod.isDshellActive()).toBe(false);
    expect(document.documentElement.classList.contains("dshell")).toBe(false);

    storageEventFromOtherTab("on");
    expect(mod.getDshellMode()).toBe("on");
    expect(mod.isDshellActive()).toBe(true);
    expect(document.documentElement.classList.contains("dshell")).toBe(true);
    expect(modeListener).toHaveBeenCalledTimes(1);
    expect(activeListener).toHaveBeenCalledTimes(1);

    // 切回 off：生效态翻转 → active 订阅者再通知一次
    storageEventFromOtherTab("off");
    expect(mod.getDshellMode()).toBe("off");
    expect(document.documentElement.classList.contains("dshell")).toBe(false);
    expect(modeListener).toHaveBeenCalledTimes(2);
    expect(activeListener).toHaveBeenCalledTimes(2);
  });

  it("storage 事件迁移旧布尔值：1/true → on，0/false → off（事件路径同启动路径）", async () => {
    const mod = await boot("off");

    storageEventFromOtherTab("1");
    expect(mod.getDshellMode()).toBe("on");
    expect(mod.isDshellActive()).toBe(true);
    expect(document.documentElement.classList.contains("dshell")).toBe(true);

    storageEventFromOtherTab("0");
    expect(mod.getDshellMode()).toBe("off");
    expect(document.documentElement.classList.contains("dshell")).toBe(false);

    storageEventFromOtherTab("true");
    expect(mod.getDshellMode()).toBe("on");

    storageEventFromOtherTab("false");
    expect(mod.getDshellMode()).toBe("off");
  });

  it("storage 事件未知字符串按旧布尔回退走 off，不与 auto 解析混淆（边界）", async () => {
    // 从非 off 档起步，验证未知值能真正触发翻转（而非同档 no-op 掩盖回退）。
    const mod = await boot("on");
    const modeListener = vi.fn();
    const activeListener = vi.fn();
    mod.subscribeDshellMode(modeListener);
    mod.subscribeDshellActive(activeListener);
    expect(mod.getDshellMode()).toBe("on");
    expect(mod.isDshellActive()).toBe(true);

    // 未知字符串（如 "maybe"）走旧布尔回退：非 "1"/"true" → off；
    // 绝不解析成 auto（auto 只能由合法字符串或暗色首见 seed 产生）。
    storageEventFromOtherTab("maybe");
    expect(mod.getDshellMode()).toBe("off");
    expect(mod.isDshellActive()).toBe(false);
    expect(document.documentElement.classList.contains("dshell")).toBe(false);
    expect(modeListener).toHaveBeenCalledTimes(1);
    expect(activeListener).toHaveBeenCalledTimes(1); // on→off 生效态翻转

    // 其它未知值同路径回退 off，且都不是 auto。
    for (const v of ["banana", "OFF", "truee", ""]) {
      storageEventFromOtherTab(v);
      expect(mod.getDshellMode(), `unknown=${JSON.stringify(v)}`).toBe("off");
      expect(mod.getDshellMode()).not.toBe("auto");
      expect(modeListener).toHaveBeenCalledTimes(1); // off→off 同档 no-op
    }

    // 与 auto 解析对照：合法 "auto" 仍正确落到 auto，未被回退路径吞掉。
    storageEventFromOtherTab("auto");
    expect(mod.getDshellMode()).toBe("auto");
    expect(modeListener).toHaveBeenCalledTimes(2);
  });

  it("storage 事件忽略非本键、键被删除（newValue=null）与同档位 no-op", async () => {
    const mod = await boot("auto");
    const modeListener = vi.fn();
    mod.subscribeDshellMode(modeListener);

    // 非本键
    storageEventFromOtherTab("on", "some.other.key");
    expect(mod.getDshellMode()).toBe("auto");

    // 键被删除
    storageEventFromOtherTab(null);
    expect(mod.getDshellMode()).toBe("auto");

    // 同档位 no-op
    storageEventFromOtherTab("auto");
    expect(mod.getDshellMode()).toBe("auto");

    expect(modeListener).not.toHaveBeenCalled();
  });
});
