import { describe, expect, it } from "vitest";
import { BurstFrameStateMachine } from "./dshell-panel-perf";

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
