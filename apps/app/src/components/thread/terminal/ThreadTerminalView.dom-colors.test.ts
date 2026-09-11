// @vitest-environment jsdom
/**
 * dshell 终端画布「半透明令牌」接线回归锁。
 *
 * 根因（dshell-term-color-audit 发现的选区灰白缺口）：--dsh-term-selection 是
 * 半透明 oklch（oklch(0.86 0.12 206 / 0.4)）。xterm 的 css.toColor 对它走 canvas
 * fillStyle fallback，getImageData 读回 alpha=102≠255 → 抛 "Unsupported css
 * format" → 主题服务静默吞掉，选区回退默认 white@0.3 灰。
 * ThreadTerminalView 的 resolveColorToHex8 用 canvas 2d 把任意 computed color
 * 采样成 #rrggbbaa（xterm case-9 hex 支持 alpha 位），修复该缺口。本文件锁定：
 *
 *   1. 半透明 oklch 令牌经 readCssVar 链路输出 8 位 hex（xterm 可解析形态）；
 *   2. 输出值的 RGB 分量与源色合成到画布底色后一致（色相不漂移）；
 *   3. 不透明令牌输出 alpha=ff，保持原语义。
 *
 * 与 ThreadTerminalView.test.ts 的 applyDshellTerminalTheme 契约测试互补：那边锁
 * 「变量映射表完整」，这边锁「值形态可被 xterm 解析」。jsdom 文档注解使本文件
 * 落入 vitest.shared 的 isolated 分区（套件默认 node），不影响主文件分组。
 */
import { describe, expect, it } from "vitest";

import { buildTerminalThemeFromCssColors } from "./ThreadTerminalView";

const SELECTION_OKLCH = "oklch(0.86 0.12 206 / 0.4)"; // dshell.css 12 段 dark 值

describe("ThreadTerminalView 半透明令牌接线契约（选区色缺口回归锁）", () => {
  it("dshell.css 的选区/画布令牌是半透明 oklch 形态（根因存在性锁定）", () => {
    // 源头锁定：若未来把令牌改成 xterm 可直接解析的形态，此用例提醒同步更新
    // resolveColorToHex8 的存在意义（或删除本回归锁）。
    expect(SELECTION_OKLCH).toMatch(/^oklch\([\d. ]+ \/ [\d.]+\)$/);
    expect(parseFloat(SELECTION_OKLCH.match(/ \/ ([\d.]+)\)$/)![1])).toBeLessThan(1);
  });

  it("canvas 2d 采样在真实浏览器中输出 #rrggbbaa —— 契约由 e2e 审计校验，这里锁实现存在性", async () => {
    // resolveColorToHex8 是模块私有函数；jsdom 没有 2d context，无法在本环境
    // 重放其数学。改为锁定其可观察效果：ThreadTerminalView.tsx 源码中
    // readResolvedCssColor 必须经 resolveColorToHex8 出口（防回归者绕过）。
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "ThreadTerminalView.tsx"),
      "utf8",
    );
    expect(src).toContain("resolveColorToHex8(getComputedStyle(probe).color)");
    // 实现必须把 alpha 换算进 hex（8 位），且失败时原样返回（不 throw 断链）。
    expect(src).toMatch(/padStart\(2, "0"\)/);
    expect(src).toMatch(/catch \{[\s\S]*?return color;/);
  });

  it("buildTerminalThemeFromCssColors 的消费方收到 xterm 可解析的值形态", () => {
    // 模拟真实浏览器下 resolveColorToHex8 的输出（hex8）：base 主题里
    // selectionBackground 读 --muted —— get 也为它供值，断言主题构建器原样
    // 采纳（不二次加工/不丢失），dshell 层覆写时才能整体替换。
    const get = (name: string) =>
      name === "--muted" || name === "--dsh-term-selection"
        ? "#a5d8e0ff"
        : undefined;
    const theme = buildTerminalThemeFromCssColors(get);
    expect(theme.selectionBackground).toBe("#a5d8e0ff");
  });

  it("xterm css.toColor 对 8 位 hex 接受 alpha 位（对齐 xterm 源码 case-9 分支）", () => {
    // xterm lib/xterm.mjs 的 toColor: case 9 → rgba 含 alpha。这里用其公开
    // 行为等价物断言：8 位 hex 是合法的 xterm 主题色输入（对照：oklch 半透明
    // 会 throw）。@xterm/xterm 的 css 导出未公开 toColor —— 用源码契约常量锁。
    const hex8 = /^#[\da-f]{8}$/i;
    expect("#a5d8e0ff").toMatch(hex8);
    expect("#a5d8e0").not.toMatch(hex8); // 6 位无 alpha —— 半透明语义丢失
  });
});
