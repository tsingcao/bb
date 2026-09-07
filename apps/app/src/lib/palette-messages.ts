/**
 * 命令面板（CommandPalette / ThreadPaletteResults）的用户可见文案 —— 单一事实来源。
 *
 * 与 lib/sidebar-messages.ts / lib/keyboard-settings-messages.ts 同一接缝契约：
 * bb-fork 目前没有 i18n 框架（全应用硬编码英文）；本模块就是未来框架接入的
 * 接缝：每个字符串是类型化 key、插值走参数（绝不字符串拼接）、消费方从这
 * 里 import 而非写字面量。接入框架时只改这一个文件 + 消费点改调 t()。
 * 注意：值是测试/自动化契约 —— CommandPalette.test.tsx、ThreadPaletteResults.test.tsx
 * 等断言这些字面量，改值必须同步改测试。
 */
export const paletteMessages = {
  /** 命令模式输入框 aria-label/placeholder。 */
  searchCommands: "Search commands",
  /** 线程搜索模式输入框 aria-label/placeholder（也是 dialog 标题）。 */
  searchThreads: "Search threads",
  /** 命令模式 dialog 的 sr-only 标题。 */
  quickPaletteTitle: "Quick palette",
  /** 命令模式结果列表 aria-label。 */
  commandsListLabel: "Commands",
  /** 线程搜索模式结果列表 aria-label。 */
  threadSearchListLabel: "Thread search results",
  /** 命令模式空态。 */
  noMatchingCommands: "No matching commands",
  /** 线程搜索分区标签（role=group 的 aria-label + 可见小标题）。 */
  recentSectionLabel: "Recent",
  threadsSectionLabel: "Threads",
  archivedSectionLabel: "Archived",
  /** 线程搜索状态行。 */
  loadingThreads: "Loading threads...",
  searchingThreads: "Searching threads...",
  searchFailed: "Search failed.",
  noMatchingThreads: "No matching threads",
  typeToSearchThreads: "Type to search threads.",
} as const;

export type PaletteMessages = typeof paletteMessages;
