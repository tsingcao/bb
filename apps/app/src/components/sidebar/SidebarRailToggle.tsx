import { Icon } from "@bb/shared-ui/icon";
import { useSidebar } from "@/components/ui/sidebar.js";

export const SIDEBAR_RAIL_COLLAPSE_LABEL = "Collapse to icon rail";
export const SIDEBAR_RAIL_EXPAND_LABEL = "Expand icon rail";

/**
 * 侧栏「icon 磁贴抽屉」开关：展开态点击收成 3rem 图标 rail；
 * rail 态点击恢复完整侧栏。悬停 rail 会暂时浮出完整侧栏（见 Sidebar 的
 * railPeek）。设置/工具页（未开 iconRail）与移动视口不受影响。
 */
export function SidebarRailToggle() {
  const { rail, setRail, isCompactViewport } = useSidebar();
  if (isCompactViewport) return null;
  const label = rail ? SIDEBAR_RAIL_EXPAND_LABEL : SIDEBAR_RAIL_COLLAPSE_LABEL;

  return (
    <button
      type="button"
      data-testid="sidebar-rail-toggle"
      aria-label={label}
      title={label}
      onClick={() => setRail((current) => !current)}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      <Icon name={rail ? "ChevronRight" : "ChevronLeft"} />
    </button>
  );
}
