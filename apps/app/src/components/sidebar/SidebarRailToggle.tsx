import {
  useAppCommandShortcut,
  useIsAppCommandModifierHeld,
} from "@/components/commands/AppCommandProvider";
import { AppCommandShortcutPill } from "@/components/commands/AppCommandShortcutHint";
import { Icon } from "@bb/shared-ui/icon";
import { sidebarMessages } from "@/lib/sidebar-messages";
import { useSidebar } from "@/components/ui/sidebar.js";

export const SIDEBAR_RAIL_COLLAPSE_LABEL = sidebarMessages.railCollapseLabel;
export const SIDEBAR_RAIL_EXPAND_LABEL = sidebarMessages.railExpandLabel;

/**
 * 侧栏「icon 磁贴抽屉」开关：展开态点击收成 3rem 图标 rail；
 * rail 态点击恢复完整侧栏。悬停 rail 会暂时浮出完整侧栏（见 Sidebar 的
 * railPeek）。设置/工具页（未开 iconRail）与移动视口不受影响。
 * 工具提示/aria 与 ⌘⇧\ 命令（sidebar.railToggle）同步文案；快捷键提示
 * 以 kbd 药丸画在按钮旁边——与全应用 shortcut hint 同一 modifier-hold 交互
 * （按住主修饰键才显示；见 AppCommandShortcutHint），icon rail 态空间不足时
 * 同样隐藏。
 */
export function SidebarRailToggle() {
  const { rail, setRail, isCompactViewport } = useSidebar();
  const shortcut = useAppCommandShortcut("sidebar.railToggle");
  const modifierHeld = useIsAppCommandModifierHeld();
  if (isCompactViewport) return null;
  const label = rail ? SIDEBAR_RAIL_EXPAND_LABEL : SIDEBAR_RAIL_COLLAPSE_LABEL;
  const hintedLabel = shortcut
    ? sidebarMessages.shortcutHint(label, shortcut.label)
    : label;
  const pill = shortcut !== null && !rail && modifierHeld ? shortcut : null;

  return (
    <>
      <button
        type="button"
        data-testid="sidebar-rail-toggle"
        aria-label={hintedLabel}
        aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
        title={hintedLabel}
        onClick={() => setRail((current) => !current)}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <Icon name={rail ? "ChevronRight" : "ChevronLeft"} />
      </button>
      {pill !== null ? (
        <AppCommandShortcutPill
          shortcut={pill}
          ariaHidden={false}
          className="hidden md:inline-flex"
        />
      ) : null}
    </>
  );
}
