import type { IconSvgElement } from "@hugeicons/react";
import type { IconName } from "./icon";

// 插件生态声明的图标名（lucide 命名约定）→ 应用图标集（hugeicons）的规范映射。
// 这是「插件图标如何解析」的唯一权威源：新增插件图标名时，若名字本身在 ICON_NAMES
// 内则自动解析（无需登记）；否则必须在本表登记映射；两者都不满足时，PluginIcon.test
// 的 shipped-plugin 扫描会在 review 期响亮失败并点名缺登记的图标。
export const PLUGIN_ICON_ALIASES: Readonly<Record<string, IconName>> = {
  MessagesSquare: "MessageSquare",
  LayoutDashboard: "GridView",
  Home: "AppWindow",
};

// 插件声明的图标名 → 应用图标集的唯一解析实现：原生名直接命中，否则经
// PLUGIN_ICON_ALIASES 映射，两者都不满足才落回 Zap 兜底。App 的
// pluginIconName 与 scripts/check-plugin-icons.ts 都调它，杜绝两处逻辑漂移。
// iconNames 由调用方传入（@bb/shared-ui/icon 的 ICON_NAMES），避免本模块
// 反向 import ./icon 形成循环依赖（icon.tsx 顶层用 EXTENDED_ICON_NAMES 拼装）。
export function resolvePluginIconName(
  icon: string | null,
  iconNames: readonly string[],
): IconName {
  if (icon === null) return "Zap";
  if (iconNames.includes(icon)) return icon as IconName;
  return PLUGIN_ICON_ALIASES[icon] ?? "Zap";
}

export const EXTENDED_ICON_NAMES = [
  "AiBrowser",
  "AiContentGenerator01",
  "AlignLeft",
  "AppWindow",
  "ArchiveRestore",
  "ArrowDown",
  "ArrowRight",
  "ArrowReloadHorizontal",
  "ArrowUp",
  "ArrowUpDown",
  "ArrowTurnBackward",
  "ArrowTurnForward",
  "ArrowUpRight",
  "Beaker",
  "BellDot",
  "Browser",
  "Brain",
  "Calendar",
  "CalendarCheckOut02",
  "ChartColumn",
  "ChevronUp",
  "ChevronsDown",
  "ChevronsUp",
  "CircleArrowShrink",
  "Clean",
  "Clock",
  "Cloud",
  "CloudOff",
  "Coffee",
  "Columns2",
  "CornerDownLeft",
  "CornerDownRight",
  "Discord",
  "DateTime",
  "Github",
  "DragDropHorizontal",
  "DragDropVertical",
  "EditFile",
  "ElectricPlugs",
  "Eye",
  "EyeOff",
  "Explore",
  "ExternalLink",
  "FileDiff",
  "File",
  "FileAttachment",
  "FileQuestion",
  "FileText",
  "FolderOpen",
  "FolderEdit",
  "FolderMinus",
  "Fork",
  "GitBranch",
  "GitMerge",
  "GitPullRequest",
  "GitPullRequestArrow",
  "GitPullRequestClosed",
  "GitPullRequestDraft",
  "Globe",
  "GridView",
  "Laptop",
  "Layers",
  "Limitation",
  "ListView",
  "Lock",
  "Mail",
  "MailOpen",
  "Maximize2",
  "Mic",
  "Minimize2",
  "NewTab",
  "PackageReceive",
  "Palette",
  "PanelBottom",
  "PanelRight",
  "Paperclip",
  "Pause",
  "Pin",
  "PinOff",
  "Play",
  "Plus",
  "Puzzle",
  "Repeat",
  "RotateCcw",
  "Rows2",
  "SecurityCheck",
  "Sent",
  "SideChat",
  "Smartphone",
  "Sort",
  "Square",
  "SquareUnlock02",
  "Star",
  "TextWrap",
  "TimeSchedule",
  "UserRound",
  "ZoomIn",
  "ZoomOut",
] as const;

export type ExtendedIconName = (typeof EXTENDED_ICON_NAMES)[number];

export type ExtendedIconMap = Readonly<
  Record<ExtendedIconName, IconSvgElement>
>;

let extendedIcons: ExtendedIconMap | null = null;
const listeners = new Set<() => void>();

export function registerExtendedIcons(map: ExtendedIconMap): void {
  if (extendedIcons === map) return;
  extendedIcons = map;
  for (const listener of listeners) listener();
}

export function getExtendedIcons(): ExtendedIconMap | null {
  return extendedIcons;
}

export function subscribeExtendedIcons(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
