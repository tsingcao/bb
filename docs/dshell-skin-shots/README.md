# DSH / NEXTLoop 皮肤 — 截图基线

DSH-WORKTABLE 视觉语言在 bb 外壳上的落地，配套 `apps/app/src/components/ui/dshell/dshell.css` 皮肤层。

## 内容
- `gallery.html` — 前后对照总览（浏览器打开即可审阅）。
- `*.png` — 38 张截图：原版 before（2）、皮肤 after（5，含紧凑视口）、
  icon rail 三态（3）、三态档位 Original/Auto/Always（4）、一次性迁移横幅（2，
  dark/light）、玻璃右侧面板/终端（3）、终端画布色值三态（3）、全部 tool tab
  逐 tab 审计 16 张（1920×1000，dark/light 并列对照）：
  Info/Diff/Terminal/Side chat 暗色全景 4 + 1.5× 局部放大 4 +
  Info/Diff/Side chat/Terminal 亮色全景 4 + 局部放大 4；
  亮色变体逐文本 WCAG 对比（canvas 祖先链合成取样）0 失败，见 gallery.html 审计注。
- 三态档位卡片在控件下方内联一行三档说明（`MODE_HELP_LINE`，与各档按钮悬停提示同源，
  改动一处两处同步），auto 档额外显示 Active/Inactive now 实时提示。

## 一次性迁移横幅（legacy 布尔值 → 三态）

opt-in 三态（Original/Auto/Always）落地前，旧版本用布尔值 `bb.dshell.enabled="1"`/
`"true"` 表示启用。`readStoredMode` 读取时把旧值迁移为 on，但存储里仍是旧值——这些
用户可能不知道新增的 Settings 入口，因此启动时展示**一次可关闭的横幅**引导到
`/settings/appearance`。

- **触发条件**：存储里仍是遗留布尔启用值且 `bb.dshell.migration.dismissed` 未写
  （`shouldShowDshellMigrationBanner`，纯函数无副作用）。
- **两个 CTA**：「Open settings」跳转 `/settings/appearance`（Appearance 标签），
  不写关闭标记——横幅保持可发现直到显式关闭；仅 ✕ 按钮写
  `bb.dshell.migration.dismissed="1"` **永久不再展示**（隐私模式写入失败仅本次会话隐藏）。
- **截图**：`migration_banner_dark.png` / `migration_banner_light.png`（1440×900，
  横幅钉在顶栏侧栏右侧，dark/light 并列见 gallery.html）。
- **复现**：本地 dev server 上 `localStorage["bb.dshell.enabled"]="1"`（无 dismissed
  键）后整页 reload，横幅即出现在首页顶栏。

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
# dshell 单元测试 gate（lib + 设置卡 + sidebar rail，本地与 CI 同一入口）：
pnpm test:dshell:unit                    # vitest run --config vitest.config.ts <8 个套件>
# 单场景：
python3 scripts/dshell-skin-snapshot.py --check --scene rail_icon
# CI 场景集（e2e harness 种子下可确定性验证的子集）：
python3 scripts/dshell-skin-snapshot.py --check --ci
```

- 依赖：Python env 需含 `playwright`（chromium 已装）+ `Pillow`。脚本自带解释器自举：
  `python3` 缺依赖时自动探测 `python3.12/3.11/3.10` 并用有依赖的解释器重执行；
  也可用 `BB_PY=<解释器路径>` 显式指定（如 `BB_PY=/Users/timcao/.local/bin/python3`）。
- 环境变量：`BB_URL`（默认 http://127.0.0.1:18154）；线程相关场景（玻璃/终端，含
  `glass_dark_terminal`/`glass_light_terminal`/`term_canvas_*`）需要
  `BB_E2E_THREAD=<线程 url>`，未设置时自动跳过（home/settings/rail 不依赖线程）。
- CI 场景集（`--ci`）：`final_dark_home`/`final_light_home`/`dshell_settings`/`rail`/
  `migration_banner`/`glass_tab_info`/`glass_dark_terminal`/`glass_light_terminal`/
  `glass_anim`。基线在 bb 的 e2e harness（`tests/integration/mobile-e2e/backend.ts`，
  fake provider + 固定种子项目/线程）下生成，CI 每次重铺同一份种子 → 像素只随皮肤
  代码变化。`glass_tab_diff`/`glass_tab_sidechat` 需要 changed files / 侧栏会话，
  harness 提供不了，由本地 dev server + 真实线程覆盖。
- `migration_banner_dark/light`：一次性迁移横幅场景——seed legacy `"1"` + 清 dismissed
  后横幅出现在首页顶栏，横幅条区域入基线；点 ✕ 后确定性断言横幅消失且
  `bb.dshell.migration.dismissed="1"`（一次性语义，不依赖像素）。注：应用里固定
  z-40 的「Show right panel」钮与横幅 ✕ 同一坐标，Playwright 坐标点击会被拦截，
  场景用 DOM 级 `.click()` 驱动 dismiss。
- 终端场景（`glass_dark_terminal`/`glass_light_terminal`）在 harness 下开真实终端：
  右面板 → Open new tab → Start terminal。**shell 标题 tab 不入画**——zsh/bash/fish 由
  宿主 shell 的 OSC 标题决定，随平台/机器不同，故 chrome 顶条只比左区（rel x 0–84：
  info/diff 图标钮 + 玻璃底）与右区（maximize/hide 图标钮）两个纯皮肤面子区，
  中间 tab 行跳过；画布底色只做色值断言（暗 rgb(8,11,18) / 亮 rgb(9,13,20)）。
  终端会话按线程持久化，场景收尾会点 Close 清理，避免残留 tab 污染后续场景基线。
- 退出码契约：**0** 全绿 / **1** 渲染回归（差异报告写入 `auto/.diff/*.diff.png`，
  双图并排 + 红色差异热区）/ **2** 基线缺失或环境错误（`--update` 校准后重跑）。
- 阈值：差异像素（>12/255）占比 ≤0.5% 且平均绝对差 ≤1.5。非确定性内容（如 xterm
  光标闪烁）不比对像素，只断言画布底色 `--dsh-term-bg` 解析 + 主色值。
- 校准纪律：皮肤有意改版后跑 `--update` 提交新基线；验证脚本能检出回归的方法是临时
  注入一处颜色改动（如 `--dsh-grid` 改红），`--check` 必须 FAIL(1) 并产出 `.diff.png`，
  随后还原。注意皮肤现为 opt-in（默认 OFF），快照脚本内部固定写入 `on`/`off`/`auto`
  偏好再整页 reload，与真实用户首启行为一致。
