# DSH / NEXTLoop 皮肤 — 截图基线

DSH-WORKTABLE 视觉语言在 bb 外壳上的落地，配套 `apps/app/src/components/ui/dshell/dshell.css` 皮肤层。

## 内容
- `gallery.html` — 前后对照总览（浏览器打开即可审阅）。
- `*.png` — 17 张 1440×900 截图：原版 before（2）、皮肤 after（5，含紧凑视口）、
  icon rail 三态（3）、三态档位 Original/Auto/Always（4，含 auto 亮/暗对照）、玻璃右侧面板/终端（3）。

## 复现（如需重拍）
1. 本地起 bb dev server：`cd bb-fork && pnpm --filter @bb/app dev`（http://127.0.0.1:18154）。
2. headless Playwright（chromium, 1440×900）逐路由截图；皮肤偏好默认 ON
   （`localStorage["bb.dshell.enabled"]`），关闭即得原版外观对照。

## 变更文件（同一提交）
- 皮肤：`apps/app/src/components/ui/dshell/dshell.css`
- 偏好/开关：`apps/app/src/lib/dshell.ts`、`.../settings/DshellAppearanceSetting.tsx`、
  `views/SettingsView.tsx`、`main.tsx`（hook + CSS import）
- icon rail：`components/ui/sidebar.tsx`（collapsible=icon 状态机）、
  `components/sidebar/SidebarRailToggle.tsx`、`.../sidebar/AppSidebar.tsx`、
  `components/layout/AppLayout.tsx`（持久化 atom）
