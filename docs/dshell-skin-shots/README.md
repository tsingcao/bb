# DSH / NEXTLoop 皮肤 — 截图基线

DSH-WORKTABLE 视觉语言在 bb 外壳上的落地，配套 `apps/app/src/components/ui/dshell/dshell.css` 皮肤层。

## 内容
- `gallery.html` — 前后对照总览（浏览器打开即可审阅）。
- `*.png` — 33 张截图：原版 before（2）、皮肤 after（5，含紧凑视口）、
  icon rail 三态（3）、三态档位 Original/Auto/Always（4）、玻璃右侧面板/终端（3）、
  全部 tool tab 逐 tab 审计 16 张（1920×1000，dark/light 并列对照）：
  Info/Diff/Terminal/Side chat 暗色全景 4 + 1.5× 局部放大 4 +
  Info/Diff/Side chat/Terminal 亮色全景 4 + 局部放大 4；
  亮色变体逐文本 WCAG 对比（canvas 祖先链合成取样）0 失败，见 gallery.html 审计注。
- 三态档位卡片在控件下方内联一行三档说明（`MODE_HELP_LINE`，与各档按钮悬停提示同源，
  改动一处两处同步），auto 档额外显示 Active/Inactive now 实时提示。

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

## xterm 画布配色接入 dshell

`ThreadTerminalView` 现通过 `applyDshellTerminalTheme` 读取 `dshell.css` 第 12 段令牌
（`--dsh-term-bg/-fg/cursor/cursor-accent/selection` + `--dsh-ansi-0..15`），
把 xterm 画布从默认黑底切到与外壳同源的蓝黑画布 + 青色光标/选区/亮色，
亮色外观下终端保持蓝黑「终端井」。皮肤关闭时原样返回（仍为原版深灰/黑底）。
皮肤开关在设置里切换时（含 auto 档随外观变化）通过 `subscribeDshellActive` 实时重刷。
验证：暗/亮画布主色 rgb(8,11,18)/rgb(9,13,20)，青色文本像素存在；关闭皮肤回到 #272727。

## 自动快照回归（headless，CI 可用）

`scripts/dshell-skin-snapshot.py` 用 headless Playwright（chromium 1920×1000）逐场景渲染
皮肤层，与 `docs/dshell-skin-shots/auto/` 基线做区域像素比对 + 终端画布颜色断言，
防止未来 CSS 改动引起皮肤回归。人类可审的 PNG 仍在 gallery；`auto/` 是机器基线。

```bash
# 校验（默认模式，等价 --check）：
pnpm test:dshell:snapshot                 # 或 python3 scripts/dshell-skin-snapshot.py --check
# 皮肤有意改动后校准基线：
pnpm test:dshell:snapshot:update          # python3 scripts/dshell-skin-snapshot.py --update
# 单场景：
python3 scripts/dshell-skin-snapshot.py --check --scene rail_icon
```

- 依赖：Python env 需含 `playwright`（chromium 已装）+ `Pillow`。脚本自带解释器自举：
  `python3` 缺依赖时自动探测 `python3.12/3.11/3.10` 并用有依赖的解释器重执行；
  也可用 `BB_PY=<解释器路径>` 显式指定（如 `BB_PY=/Users/timcao/.local/bin/python3`）。
- 环境变量：`BB_URL`（默认 http://127.0.0.1:18154）；线程相关场景（玻璃/终端，含
  `glass_dark_terminal`/`glass_light_terminal`/`term_canvas_*`）需要
  `BB_E2E_THREAD=<线程 url>`，未设置时自动跳过（home/settings/rail 不依赖线程）。
- 退出码契约：**0** 全绿 / **1** 渲染回归（差异报告写入 `auto/.diff/*.diff.png`，
  双图并排 + 红色差异热区）/ **2** 基线缺失或环境错误（`--update` 校准后重跑）。
- 阈值：差异像素（>12/255）占比 ≤0.5% 且平均绝对差 ≤1.5。非确定性内容（如 xterm
  光标闪烁）不比对像素，只断言画布底色 `--dsh-term-bg` 解析 + 主色值。
- 校准纪律：皮肤有意改版后跑 `--update` 提交新基线；验证脚本能检出回归的方法是临时
  注入一处颜色改动（如 `--dsh-grid` 改红），`--check` 必须 FAIL(1) 并产出 `.diff.png`，
  随后还原。注意皮肤现为 opt-in（默认 OFF），快照脚本内部固定写入 `on`/`off`/`auto`
  偏好再整页 reload，与真实用户首启行为一致。
