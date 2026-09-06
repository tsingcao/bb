/**
 * 键盘设置（KeyboardSettingsSection）的用户可见文案 —— 单一事实来源。
 *
 * 与 lib/sidebar-messages.ts 同一接缝契约：类型化 key、插值走参数（绝不字符串
 * 拼接）、消费方从这里 import 而非写字面量。接入 i18n 框架时只改这一个文件。
 * 注意：值是测试/自动化契约 —— KeyboardSettingsSection.test.tsx 与
 * scripts/keyboard-rebind-e2e.py 都断言这些字面量，改值必须同步改测试。
 */
export const keyboardSettingsMessages = {
  unassignedShortcutFallback: "unassigned",
  errorNonModifierKey: "Press a non-modifier key.",
  errorRequireModifier: "Use Command, Control, or Alt with a key.",
  /** 如 "Recording shortcut for Toggle icon rail. Press keys or Escape to cancel." */
  recordingAriaLabel: (commandLabel: string): string =>
    `Recording shortcut for ${commandLabel}. Press keys or Escape to cancel.`,
  /** 如 "Record shortcut for Toggle icon rail, current shortcut ⇧⌘\\" */
  recordAriaLabel: (commandLabel: string, shortcutLabel: string): string =>
    `Record shortcut for ${commandLabel}, current shortcut ${shortcutLabel}`,
  recordingButtonLabel: "Press keys",
  unassignedButtonLabel: "Unassigned",
  webBadge: "Web",
  desktopBadge: "Desktop",
  customBadge: "Custom",
  defaultShortcutAriaLabel: (
    commandLabel: string,
    plural: boolean,
  ): string => `Default ${plural ? "shortcuts" : "shortcut"} for ${commandLabel}`,
  defaultShortcutSingular: "Default:",
  defaultShortcutPlural: "Defaults:",
  conflictMessage: (labels: string): string =>
    `Also used by ${labels}. Context determines which command runs.`,
  clearShortcutAriaLabel: (commandLabel: string): string =>
    `Clear shortcut for ${commandLabel}`,
  resetShortcutAriaLabel: (commandLabel: string): string =>
    `Reset shortcut for ${commandLabel}`,
  resetAllLabel: "Reset all",
  sectionTitle: "Keyboard shortcuts",
  sectionDescription:
    "Click a shortcut, then press its new keys. Changes sync to every bb window.",
  showHintsDescription: "Show shortcut badges after holding Command or Control.",
  showHintsLabel: "Show keyboard hints when holding CMD / Control",
  searchAriaLabel: "Search keyboard shortcuts",
  searchPlaceholder: "Search shortcuts",
  noMatchesMessage: (query: string): string =>
    `No shortcuts match “${query}”.`,
} as const;