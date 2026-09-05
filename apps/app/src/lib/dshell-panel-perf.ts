/**
 * dshell 面板 backdrop-filter 性能护栏
 * -------------------------------------
 * 玻璃（blur(22px)）在面板滚动 / 终端高频重绘 / 分栏拖拽时逐帧重采样很贵。
 * 这里监听面板与分栏网格内的 scroll / scrollend / pointer 事件，在繁忙窗口内
 * 给 <html> 挂 `dshell-scrubbing` 类，由 dshell.css 第 13 段把模糊半径临时降级
 * （22px → 6px、底色加不透明度补可读性），安静后 ~150ms 自动恢复满血玻璃。
 * 纯增强：皮肤关闭时类不匹配任何 CSS，零副作用。
 */

const SCRUB_CLASS = "dshell-scrubbing";
const SCROLL_OFF_DELAY_MS = 150;

const PANEL_SELECTOR = '[data-panel-id="thread-detail-secondary-panel"]';
const GRID_SELECTOR = '[data-split-resize-grid-root]';
const HANDLE_SELECTOR =
  '[id$="-secondary-panel-handle"], [role="separator"][aria-orientation="vertical"]';

let scrubbing = false;
let scrollOffTimer: number | null = null;
let dragOffTimer: number | null = null;

function isInScrubRegion(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    (target.closest(PANEL_SELECTOR) !== null ||
      target.closest(GRID_SELECTOR) !== null)
  );
}

function setScrubbing(on: boolean): void {
  if (scrubbing === on) {
    return;
  }
  scrubbing = on;
  document.documentElement.classList.toggle(SCRUB_CLASS, on);
}

function scheduleScrollOff(): void {
  if (scrollOffTimer !== null) {
    window.clearTimeout(scrollOffTimer);
  }
  scrollOffTimer = window.setTimeout(() => setScrubbing(false), SCROLL_OFF_DELAY_MS);
}

function handleScroll(event: Event): void {
  if (!isInScrubRegion(event.target)) {
    return;
  }
  setScrubbing(true);
  scheduleScrollOff();
}

function handleScrollEnd(event: Event): void {
  if (!isInScrubRegion(event.target)) {
    return;
  }
  if (scrollOffTimer !== null) {
    window.clearTimeout(scrollOffTimer);
    scrollOffTimer = null;
  }
  setScrubbing(false);
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
  setScrubbing(true);
  if (dragOffTimer !== null) {
    window.clearTimeout(dragOffTimer);
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
  setScrubbing(false);
}

export function installDshellPanelPerformanceGuard(): () => void {
  const options: AddEventListenerOptions = { capture: true, passive: true };
  const scrollOptions: AddEventListenerOptions = { capture: true };
  document.addEventListener("scroll", handleScroll, options);
  document.addEventListener("scrollend", handleScrollEnd, options);
  document.addEventListener("pointerdown", handlePointerDown, scrollOptions);
  document.addEventListener("pointerup", handlePointerUp, scrollOptions);
  return () => {
    document.removeEventListener("scroll", handleScroll, options);
    document.removeEventListener("scrollend", handleScrollEnd, options);
    document.removeEventListener("pointerdown", handlePointerDown, scrollOptions);
    document.removeEventListener("pointerup", handlePointerUp, scrollOptions);
    if (scrollOffTimer !== null) window.clearTimeout(scrollOffTimer);
    if (dragOffTimer !== null) window.clearTimeout(dragOffTimer);
    setScrubbing(false);
  };
}
