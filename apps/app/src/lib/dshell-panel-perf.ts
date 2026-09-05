/**
 * dshell 面板 backdrop-filter 性能护栏
 * -------------------------------------
 * 玻璃（blur(22px)）在面板滚动 / 终端高频重绘 / 分栏拖拽时逐帧重采样很贵。
 * 三类繁忙来源统一收口：任一来源处于活动期就给 <html> 挂 `dshell-scrubbing`
 * 类，由 dshell.css 第 13 段把模糊半径临时降级（22px → 6px、底色加不透明度补
 * 可读性）；来源退出（或安静 ~150ms）后恢复满血玻璃。多来源叠加时用 Set 计数，
 * 互不抢占（滚动刚停但终端仍在刷屏时保持降级）。
 *
 * 来源：
 *   1. scroll —— 面板/分栏网格内的滚动事件（含终端滚动回看）；
 *   2. drag   —— 分栏分隔条拖拽（pointerdown/up）；
 *   3. burst  —— 终端输出突发：无滚动但高频重绘（xterm canvas 逐帧重画）。
 *                终端渲染在 canvas 上，DOM MutationObserver 观察不到逐帧输出，
 *                所以用 rAF 空闲检测：仅当面板内存在终端时启动一个 rAF 看门狗，
 *                窗口均值帧时长 ≥ 阈值持续若干帧 → 判定突发、降级；恢复安静
 *                （均值帧时长回落）持续若干帧 → 撤销（另加 ~150ms 静置延迟）。
 *
 * 纯增强：皮肤关闭时类不匹配任何 CSS，零副作用。
 */

const SCRUB_CLASS = "dshell-scrubbing";
const SCROLL_OFF_DELAY_MS = 150;
const BURST_OFF_DELAY_MS = 150;
/** 终端在场探测周期：看门狗只在面板内存在终端时运行（避免常驻 rAF 开销）。 */
const TERMINAL_PRESENCE_PROBE_MS = 500;

const PANEL_SELECTOR = '[data-panel-id="thread-detail-secondary-panel"]';
const GRID_SELECTOR = '[data-split-resize-grid-root]';
const HANDLE_SELECTOR =
  '[id$="-secondary-panel-handle"], [role="separator"][aria-orientation="vertical"]';
/** 只看面板内部的终端：独立/分栏终端是不透明白底，不重采样玻璃，无需降级。 */
const TERMINAL_IN_PANEL_SELECTOR = `${PANEL_SELECTOR} [data-app-terminal]`;

type ScrubSource = "scroll" | "drag" | "burst";

const activeSources = new Set<ScrubSource>();
let scrubbing = false;
let scrollOffTimer: number | null = null;
let dragOffTimer: number | null = null;
let burstOffTimer: number | null = null;

function syncScrubbing(): void {
  const on = activeSources.size > 0;
  if (on === scrubbing) {
    return;
  }
  scrubbing = on;
  document.documentElement.classList.toggle(SCRUB_CLASS, on);
}

function engage(source: ScrubSource): void {
  activeSources.add(source);
  syncScrubbing();
}

function disengage(source: ScrubSource): void {
  activeSources.delete(source);
  syncScrubbing();
}

function isInScrubRegion(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    (target.closest(PANEL_SELECTOR) !== null ||
      target.closest(GRID_SELECTOR) !== null)
  );
}

function clearScrollOffTimer(): void {
  if (scrollOffTimer !== null) {
    window.clearTimeout(scrollOffTimer);
    scrollOffTimer = null;
  }
}

function handleScroll(event: Event): void {
  if (!isInScrubRegion(event.target)) {
    return;
  }
  engage("scroll");
  clearScrollOffTimer();
  scrollOffTimer = window.setTimeout(() => disengage("scroll"), SCROLL_OFF_DELAY_MS);
}

function handleScrollEnd(event: Event): void {
  if (!isInScrubRegion(event.target)) {
    return;
  }
  clearScrollOffTimer();
  disengage("scroll");
}

/** 分栏拖拽：按下分隔条开始降级，松手立即恢复（拖拽中滚动事件也可能已接管）。 */
function handlePointerDown(event: PointerEvent): void {
  if (!(event.target instanceof Element)) {
    return;
  }
  const isHandle =
    event.target.closest(HANDLE_SELECTOR) !== null &&
    event.target.closest(GRID_SELECTOR) !== null;
  if (!isHandle) {
    return;
  }
  engage("drag");
  if (dragOffTimer !== null) {
    window.clearTimeout(dragOffTimer);
    dragOffTimer = null;
  }
}

function handlePointerUp(event: PointerEvent): void {
  if (!isInScrubRegion(event.target)) {
    return;
  }
  if (dragOffTimer !== null) {
    window.clearTimeout(dragOffTimer);
    dragOffTimer = null;
  }
  disengage("drag");
}

/**
 * 终端输出突发判定机（纯逻辑，可单测）。
 *
 * 滞回：未降级时，只有窗口均值帧时长 ≥ engageAvgMs 且连续 engageRuns 个窗口
 * 才升级为“突发”（单帧 GC 尖峰/瞬时卡顿不会误触发）；已降级时，只有均值回落
 * 到 ≤ releaseAvgMs 且连续 releaseRuns 个窗口才撤销（输出间隙的小停顿不会
 * 让玻璃来回跳）。engage/release 阈值分离（33ms vs 20ms）保证区间内稳定。
 */
export type BurstFrameAction = "engage" | "release" | "none";

export interface BurstStateMachineOptions {
  /** 滑动窗口帧数（不足时不判） */
  windowSize?: number;
  /** 未降级时：窗口均值帧时长 ≥ 此值视为繁忙帧窗口（ms） */
  engageAvgMs?: number;
  /** 连续多少个繁忙窗口后触发降级 */
  engageRuns?: number;
  /** 已降级时：窗口均值帧时长 ≤ 此值视为空闲窗口（ms） */
  releaseAvgMs?: number;
  /** 连续多少个空闲窗口后撤销降级 */
  releaseRuns?: number;
}

const BURST_DEFAULTS: Required<BurstStateMachineOptions> = {
  windowSize: 4,
  engageAvgMs: 33,
  engageRuns: 3,
  releaseAvgMs: 20,
  releaseRuns: 6,
};

export class BurstFrameStateMachine {
  private readonly opts: Required<BurstStateMachineOptions>;
  private readonly window: number[] = [];
  private engaged = false;
  private busyRuns = 0;
  private idleRuns = 0;

  constructor(opts: BurstStateMachineOptions = {}) {
    this.opts = { ...BURST_DEFAULTS, ...opts };
  }

  get isEngaged(): boolean {
    return this.engaged;
  }

  reset(): void {
    this.window.length = 0;
    this.engaged = false;
    this.busyRuns = 0;
    this.idleRuns = 0;
  }

  /** 喂一帧的时长（ms），返回本帧后状态机的动作。 */
  onFrame(dtMs: number): BurstFrameAction {
    this.window.push(dtMs);
    if (this.window.length > this.opts.windowSize) {
      this.window.shift();
    }
    if (this.window.length < this.opts.windowSize) {
      return "none";
    }
    const avg = this.window.reduce((a, b) => a + b, 0) / this.window.length;
    if (!this.engaged) {
      if (avg >= this.opts.engageAvgMs) {
        this.busyRuns += 1;
        this.idleRuns = 0;
        if (this.busyRuns >= this.opts.engageRuns) {
          this.engaged = true;
          this.busyRuns = 0;
          return "engage";
        }
      } else {
        this.busyRuns = 0;
      }
    } else {
      if (avg <= this.opts.releaseAvgMs) {
        this.idleRuns += 1;
        this.busyRuns = 0;
        if (this.idleRuns >= this.opts.releaseRuns) {
          this.engaged = false;
          this.idleRuns = 0;
          return "release";
        }
      } else {
        this.idleRuns = 0;
      }
    }
    return "none";
  }
}

// --- burst 看门狗（rAF 空闲检测） ------------------------------------------
let burstMachine: BurstFrameStateMachine | null = null;
let burstRafId: number | null = null;
let burstLastFrame = 0;
let burstProbeTimer: number | null = null;

function clearBurstOffTimer(): void {
  if (burstOffTimer !== null) {
    window.clearTimeout(burstOffTimer);
    burstOffTimer = null;
  }
}

function burstLoop(t: number): void {
  burstRafId = null;
  if (burstMachine === null) {
    return;
  }
  if (burstLastFrame !== 0) {
    const dt = t - burstLastFrame;
    const action = burstMachine.onFrame(dt);
    if (action === "engage") {
      clearBurstOffTimer();
      engage("burst");
    } else if (action === "release") {
      clearBurstOffTimer();
      burstOffTimer = window.setTimeout(
        () => disengage("burst"),
        BURST_OFF_DELAY_MS,
      );
    }
  }
  burstLastFrame = t;
  burstRafId = requestAnimationFrame(burstLoop);
}

function armBurstWatchdog(): void {
  if (burstMachine !== null) {
    return;
  }
  burstMachine = new BurstFrameStateMachine();
  burstLastFrame = 0;
  burstRafId = requestAnimationFrame(burstLoop);
}

function disarmBurstWatchdog(): void {
  if (burstMachine === null) {
    return;
  }
  if (burstRafId !== null) {
    cancelAnimationFrame(burstRafId);
    burstRafId = null;
  }
  burstMachine.reset();
  burstMachine = null;
  burstLastFrame = 0;
  clearBurstOffTimer();
  disengage("burst");
}

function probeTerminalPresence(): void {
  const present = document.querySelector(TERMINAL_IN_PANEL_SELECTOR) !== null;
  if (present) {
    armBurstWatchdog();
  } else {
    disarmBurstWatchdog();
  }
}

export function installDshellPanelPerformanceGuard(): () => void {
  const options: AddEventListenerOptions = { capture: true, passive: true };
  const scrollOptions: AddEventListenerOptions = { capture: true };
  document.addEventListener("scroll", handleScroll, options);
  document.addEventListener("scrollend", handleScrollEnd, options);
  document.addEventListener("pointerdown", handlePointerDown, scrollOptions);
  document.addEventListener("pointerup", handlePointerUp, scrollOptions);
  burstProbeTimer = window.setInterval(
    probeTerminalPresence,
    TERMINAL_PRESENCE_PROBE_MS,
  );
  probeTerminalPresence();
  return () => {
    document.removeEventListener("scroll", handleScroll, options);
    document.removeEventListener("scrollend", handleScrollEnd, options);
    document.removeEventListener("pointerdown", handlePointerDown, scrollOptions);
    document.removeEventListener("pointerup", handlePointerUp, scrollOptions);
    if (burstProbeTimer !== null) {
      window.clearInterval(burstProbeTimer);
      burstProbeTimer = null;
    }
    disarmBurstWatchdog();
    clearScrollOffTimer();
    if (dragOffTimer !== null) {
      window.clearTimeout(dragOffTimer);
      dragOffTimer = null;
    }
    activeSources.clear();
    scrubbing = false;
    document.documentElement.classList.remove(SCRUB_CLASS);
  };
}
