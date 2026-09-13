import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BurstFrameStateMachine,
  installDshellPanelPerformanceGuard,
} from "./dshell-panel-perf";

/**
 * 终端输出突发判定机（BurstFrameStateMachine）的滞回契约单测：
 *   1. 快速帧（~60fps）永不触发降级；
 *   2. 单帧/单窗口尖峰不误触发（需要连续 engageRuns 个繁忙窗口）；
 *   3. 持续繁忙帧 → engage 且保持 engaged；
 *   4. 已降级后，持续空闲帧 → release（连续 releaseRuns 个窗口）；
 *   5. 输出间隙的小停顿不会撤销（busy 会清零 idleRuns）；
 *   6. 窗口均值语义：偶发快帧混入繁忙流不打断 engage 累积。
 */

describe("BurstFrameStateMachine", () => {
  it("快速帧（~16ms）永不触发", () => {
    const m = new BurstFrameStateMachine();
    for (let i = 0; i < 200; i++) {
      expect(m.onFrame(16)).toBe("none");
    }
    expect(m.isEngaged).toBe(false);
  });

  it("单个繁忙窗口不触发（需连续 engageRuns 个窗口）", () => {
    const m = new BurstFrameStateMachine();
    // 窗口 size=4：先灌 3 帧 16ms 凑齐窗口 → 均值 <33，busyRuns 不涨
    m.onFrame(16); m.onFrame(16); m.onFrame(16);
    expect(m.onFrame(16)).toBe("none");
    // 一个繁忙窗口（40ms ×4）
    expect(m.onFrame(40)).toBe("none");
    expect(m.onFrame(40)).toBe("none");
    expect(m.onFrame(40)).toBe("none");
    expect(m.onFrame(40)).toBe("none"); // 均值 40 → busyRuns=1，但不足 3
    expect(m.isEngaged).toBe(false);
  });

  it("持续繁忙帧触发 engage 并保持", () => {
    const m = new BurstFrameStateMachine();
    const actions: string[] = [];
    // 3 个连续繁忙窗口（每个 4 帧 40ms）
    for (let run = 0; run < 3; run++) {
      for (let f = 0; f < 4; f++) {
        actions.push(m.onFrame(40));
      }
    }
    expect(actions).toContain("engage");
    expect(m.isEngaged).toBe(true);
    // 持续繁忙不再重复发 engage（保持 none）
    for (let f = 0; f < 8; f++) {
      expect(m.onFrame(40)).toBe("none");
    }
    expect(m.isEngaged).toBe(true);
  });

  it("已降级后连续空闲窗口触发 release", () => {
    const m = new BurstFrameStateMachine();
    for (let run = 0; run < 3; run++) {
      for (let f = 0; f < 4; f++) m.onFrame(40);
    }
    expect(m.isEngaged).toBe(true);
    const actions: string[] = [];
    // releaseRuns=6 个空闲窗口（每个 4 帧 16ms）
    for (let run = 0; run < 6; run++) {
      for (let f = 0; f < 4; f++) {
        actions.push(m.onFrame(16));
      }
    }
    expect(actions).toContain("release");
    expect(m.isEngaged).toBe(false);
    // release 后继续空闲 → none
    for (let f = 0; f < 4; f++) {
      expect(m.onFrame(16)).toBe("none");
    }
  });

  it("输出间隙的小停顿不会撤销降级（busy 清零 idleRuns）", () => {
    const m = new BurstFrameStateMachine();
    for (let run = 0; run < 3; run++) {
      for (let f = 0; f < 4; f++) m.onFrame(40);
    }
    expect(m.isEngaged).toBe(true);
    // 两个空闲窗口（本应 release 2/6 进度）…
    for (let f = 0; f < 8; f++) m.onFrame(16);
    expect(m.isEngaged).toBe(true);
    // …被繁忙窗口打断：idleRuns 清零
    for (let f = 0; f < 4; f++) m.onFrame(40);
    // 再给 6 个空闲窗口才 release（证明之前的 2 个窗口被清零）
    const actions: string[] = [];
    for (let run = 0; run < 6; run++) {
      for (let f = 0; f < 4; f++) actions.push(m.onFrame(16));
    }
    expect(actions).toContain("release");
  });

  it("窗口均值语义：偶发快帧不打断繁忙窗口累积", () => {
    const m = new BurstFrameStateMachine();
    // 每个窗口 4 帧中 3 慢 1 快：均值 (40*3+16)/4=34 ≥ 33
    const feedWindow = () => {
      m.onFrame(40); m.onFrame(16); m.onFrame(40); m.onFrame(40);
    };
    let engaged = false;
    for (let run = 0; run < 6 && !engaged; run++) {
      feedWindow();
      engaged = m.isEngaged;
    }
    expect(engaged).toBe(true);
  });

  it("reset 清空窗口与状态", () => {
    const m = new BurstFrameStateMachine();
    for (let run = 0; run < 3; run++) {
      for (let f = 0; f < 4; f++) m.onFrame(40);
    }
    expect(m.isEngaged).toBe(true);
    m.reset();
    expect(m.isEngaged).toBe(false);
    for (let i = 0; i < 30; i++) {
      expect(m.onFrame(16)).toBe("none");
    }
    expect(m.isEngaged).toBe(false);
  });
});

// --- split-pane 回归：前缀匹配 [-pane-N] 宿主的滚动降级 ---------------------
//
// 回归背景：§11/§13 玻璃链原本只精确匹配 thread-detail-secondary-panel，
// SecondaryPanelLayout 分栏/多栏布局下发的 thread-detail-secondary-panel-2
// （-pane-2）等变体会漏皮肤、也漏性能护栏。dshell.css 侧已改 ^= 前缀匹配；
// 这组测试锁定 guard 的 JS 侧同一契约：任何 -pane-N 变体（以及分栏网格根）
// 内滚动都给 <html> 挂 dshell-scrubbing，静止 ~150ms 后摘除；玻璃链外的
// 容器滚动不误触发。jsdom 真实 DOM 树（closest 可用），滚动经事件冒泡派发。

// @vitest-environment jsdom

describe("installDshellPanelPerformanceGuard split-pane 滚动降级", () => {
  let uninstall: (() => void) | null = null;

  afterEach(() => {
    uninstall?.();
    uninstall = null;
    vi.useRealTimers();
    document.documentElement.classList.remove("dshell-scrubbing");
    document.body.innerHTML = "";
  });

  function mountPanel(panelId: string): HTMLElement {
    const panel = document.createElement("div");
    panel.setAttribute("data-panel-id", panelId);
    const scroller = document.createElement("div");
    panel.appendChild(scroller);
    document.body.appendChild(panel);
    return scroller;
  }

  function htmlHasScrubbing(): boolean {
    return document.documentElement.classList.contains("dshell-scrubbing");
  }

  it("主面板（无后缀）滚动挂 dshell-scrubbing（基线形态不回归）", () => {
    const scroller = mountPanel("thread-detail-secondary-panel");
    uninstall = installDshellPanelPerformanceGuard();
    expect(htmlHasScrubbing()).toBe(false);

    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(htmlHasScrubbing()).toBe(true);
  });

  it("-pane-2 面板滚动同样挂 dshell-scrubbing（前缀匹配回归）", () => {
    const scroller = mountPanel("thread-detail-secondary-panel-2");
    uninstall = installDshellPanelPerformanceGuard();

    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(htmlHasScrubbing()).toBe(true);
  });

  it("-pane-2 面板内深层子元素滚动经冒泡同样命中", () => {
    const scroller = mountPanel("thread-detail-secondary-panel-2");
    const deep = document.createElement("ul");
    scroller.appendChild(deep);
    uninstall = installDshellPanelPerformanceGuard();

    deep.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(htmlHasScrubbing()).toBe(true);
  });

  it("-pane-3 变体与分栏网格根同样命中（前缀契约的完整面）", () => {
    const scrollerP3 = mountPanel("thread-detail-secondary-panel-3");
    const grid = document.createElement("div");
    grid.setAttribute("data-split-resize-grid-root", "");
    const gridScroller = document.createElement("div");
    grid.appendChild(gridScroller);
    document.body.appendChild(grid);
    // 先切假时钟再装 guard：off-timer 必须由假 setTimeout 创建才能被 advance 驱动
    vi.useFakeTimers();
    uninstall = installDshellPanelPerformanceGuard();

    scrollerP3.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(htmlHasScrubbing()).toBe(true);
    // 网格根路径：摘掉 scroll 来源（静止到期）后，第二来源仍能独立挂上
    vi.advanceTimersByTime(200); // SCROLL_OFF_DELAY_MS=150 到期 → scroll 来源退出
    expect(htmlHasScrubbing()).toBe(false);
    gridScroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(htmlHasScrubbing()).toBe(true);
  });

  it("-pane-2 滚动静止 ~150ms 后自动摘除 dshell-scrubbing", () => {
    const scroller = mountPanel("thread-detail-secondary-panel-2");
    vi.useFakeTimers();
    uninstall = installDshellPanelPerformanceGuard();
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(htmlHasScrubbing()).toBe(true);

    vi.advanceTimersByTime(100); // 未到 150ms：保持降级（滚动可能随时继续）
    expect(htmlHasScrubbing()).toBe(true);
    vi.advanceTimersByTime(100); // 累计 200ms > 150ms：恢复满血玻璃
    expect(htmlHasScrubbing()).toBe(false);
  });

  it("scrollend 立即摘除，不等 150ms 静置（-pane-2 同样生效）", () => {
    const scroller = mountPanel("thread-detail-secondary-panel-2");
    uninstall = installDshellPanelPerformanceGuard();
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(htmlHasScrubbing()).toBe(true);

    scroller.dispatchEvent(new Event("scrollend", { bubbles: true }));
    expect(htmlHasScrubbing()).toBe(false);
  });

  it("scrollend 后的 trailing scroll 定时器被清理：不会二次挂回", () => {
    const scroller = mountPanel("thread-detail-secondary-panel-2");
    uninstall = installDshellPanelPerformanceGuard();
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    scroller.dispatchEvent(new Event("scrollend", { bubbles: true }));
    expect(htmlHasScrubbing()).toBe(false);

    vi.useFakeTimers();
    vi.advanceTimersByTime(400); // scroll 的 off-timer 若未清理会在此刻把类挂回
    expect(htmlHasScrubbing()).toBe(false);
  });

  it("玻璃链外容器（sidebar / 无归属根）滚动不误触发", () => {
    const sidebar = document.createElement("aside");
    sidebar.setAttribute("data-panel-id", "app-sidebar");
    const sidebarScroller = document.createElement("div");
    sidebar.appendChild(sidebarScroller);
    document.body.appendChild(sidebar);
    uninstall = installDshellPanelPerformanceGuard();

    sidebarScroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(htmlHasScrubbing()).toBe(false);
  });

  it("滚动中途 unmount：guard 卸载立即摘类并清定时器", () => {
    const scroller = mountPanel("thread-detail-secondary-panel-2");
    uninstall = installDshellPanelPerformanceGuard();
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(htmlHasScrubbing()).toBe(true);

    uninstall();
    uninstall = null;
    expect(htmlHasScrubbing()).toBe(false);
    vi.useFakeTimers();
    vi.advanceTimersByTime(500); // off-timer 已清 → 不再有任何状态翻转
    expect(htmlHasScrubbing()).toBe(false);
  });
});
