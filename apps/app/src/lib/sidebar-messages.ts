/**
 * 侧栏/rail 工作流的用户可见文案 —— 单一事实来源。
 *
 * bb-fork 目前没有 i18n 框架（全应用硬编码英文）；本模块就是未来框架接入的
 * 接缝：每个字符串是类型化 key、插值走参数（绝不字符串拼接）、消费方从这
 * 里 import 而非写字面量。接入框架时只改这一个文件 + 消费点改调 t()。
 */
export const sidebarMessages = {
  railCollapseLabel: "Collapse to icon rail",
  railExpandLabel: "Expand icon rail",
  toggleSidebarLabel: "Toggle sidebar",
  /** 把快捷键提示合成进 label/aria/tooltip 文案，如 "Toggle icon rail (⌘⇧\)"。 */
  shortcutHint: (label: string, shortcut: string): string =>
    `${label} (${shortcut})`,
} as const;
