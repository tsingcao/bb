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

## 工作流归属清单

六个皮肤工作流（终端主题 / 玻璃动画 / 性能护栏 / 快照 gate / overlay peek / 单测）的
提交归属与未提交残留见 [WORKSTREAMS.md](./WORKSTREAMS.md)——改皮肤代码/CI/基线前先查
归属，避免并发流互相追赶基线。

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

## 重置到全新 clone 语义（pristine reset）

基线重拍前若怀疑工作区漂移（stale dist / 残留 harness / 过期 diff 报告），先跑：

    bash scripts/dshell-pristine-reset.sh              # 清态 → build → harness → 线程无关 --check
    bash scripts/dshell-pristine-reset.sh --skip-build # 跳过 build（仅清态+check）

脚本清理三类 harness 之外的漂移源（harness 数据本身每次 mkdtemp 全新，无需清理）：

1. **apps/app/dist 过期** —— `BB_MOBILE_E2E_SERVE_APP=1` 服务的是已构建产物；
   全新 clone 会先 build，本脚本同样先 `turbo build --filter=@bb/app`；
2. **残留 harness 进程**（占用 41999 端口 → 连到旧种子数据）；
3. **过期审阅产物**（/tmp 场景截图 + `auto/.diff/` 差异报告，均不属提交基线）。

然后起 harness、跑**线程无关** `--check --ci`（无 `BB_E2E_THREAD`：玻璃/终端
场景自动 skip，剩下的就是 home/settings/rail 全套）。退出码：0 绿 / 1
FAIL·MISSING / 2 环境。dist 与源码不同步时**不要**用 `--skip-build`，否则结果
不代表全新 clone 语义。

## 复现（如需重拍）

**一条命令**在本地 dev server（http://127.0.0.1:18154）上重拍**全部**逐 tab 审计产物：

    cd bb-fork && pnpm --filter @bb/app dev                       # 起 dev server
    BB_E2E_THREAD=/projects/proj_xxx/threads/thr_xxx \
      pnpm test:dshell:snapshot:update                            # 校准 auto 基线 + 重拍 gallery + audit.json
    BB_E2E_THREAD=/projects/proj_xxx/threads/thr_xxx \
      pnpm test:dshell:snapshot:gallery                           # 只重拍 gallery PNG + audit.json（不动基线）

`scripts/dshell-skin-snapshot.py` 的逐 tab 场景（info/diff/terminal/sidechat ×
dark/light）输出 16 张：全视口 1920×1000 全景 + 1.5× 面板放大，写入本目录；亮色
变体逐文本 WCAG 对比（canvas 祖先链合成取样）与明暗像素占比、玻璃 alpha、console
错误一起汇总到 `docs/dshell-skin-shots/audit.json`。线程相关场景需要真实线程
（`BB_E2E_THREAD`）；`--scene glass_tab_info --gallery` 可只重拍单个场景。

**玻璃 chrome 门**（逐 tab 审计，CI 同款入口）在真实线程下跑：

    BB_E2E_THREAD=/projects/<proj>/threads/<thr> \
      pnpm test:dshell:snapshot --scene glass_tab_

注意：pnpm 9 会把 `--` 分隔符原样透传给脚本（argparse 报 `unrecognized arguments`），
参数直接跟在脚本名后即可，不要写 `pnpm test:dshell:snapshot -- --scene ...`。

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
- 离线重放（`--json-only`）：每次全量运行（`--check`/`--update`/`--gallery`/`--ci`，
  不带 `--scene`）结束时把结构化审计 + FAIL/SKIP/console 错误 + 退出码落盘为
  `docs/dshell-skin-shots/.last-run.json`（机器数据，已 gitignore；崩溃的运行也留档
  exit 70 + 已跑场景的部分数据）。`--json-only` 随后把它重放成 `audit.json`，
  **纯 stdlib、不启动 Playwright**——没装浏览器依赖的系统 python3 也能跑：

  ```bash
  python3 scripts/dshell-skin-snapshot.py --check          # 真实运行，落盘 .last-run.json
  python3 scripts/dshell-skin-snapshot.py --json-only      # 离线重放 → audit.json
  ```

  CI 里快照步之后固定跑重放步（`if: always()`，失败的运行也出 audit artifact），
  供无浏览器环境下离线审阅玻璃 alpha / 对比度 / console 错误历史。`--last-run`/`--out`
  可重定向记录与输出路径；记录缺失/不可解析/schema 不符退出码 2。
- 阈值：差异像素（>12/255）占比 ≤0.5% 且平均绝对差 ≤1.5。非确定性内容（如 xterm
  光标闪烁）不比对像素，只断言画布底色 `--dsh-term-bg` 解析 + 主色值。
- 校准纪律：皮肤有意改版后跑 `--update` 提交新基线；验证脚本能检出回归的方法是临时
  注入一处颜色改动（如 `--dsh-grid` 改红），`--check` 必须 FAIL(1) 并产出 `.diff.png`，
  随后还原。注意皮肤现为 opt-in（默认 OFF），快照脚本内部固定写入 `on`/`off`/`auto`
  偏好再整页 reload，与真实用户首启行为一致。

## 对比度审计 + 元素覆盖快照（CI 可用）

`scripts/dshell_contrast_audit.py` 用同一 harness/playwright 跑 8 个确定性主表面场景
（home×2 / settings×2 / rail 三态 / migration banner×2）的 computed-style WCAG 断言
（普通文本 ≥4.5:1、大号 ≥3.0:1），补像素快照管不到的「玻璃化后文字可读」。

```bash
pnpm test:dshell:contrast               # 全场景 + 元素覆盖基线对比（本地 = CI 同一入口）
pnpm test:dshell:contrast --scene rail  # 只看 rail 前缀（局部审计，跳过基线对比）
pnpm test:dshell:contrast --url http://127.0.0.1:18154   # 非默认实例
pnpm test:dshell:contrast --json -      # 汇总 JSON 打 stdout（每场景元素/失败/比率直方图）
pnpm test:dshell:contrast --json out.json  # 汇总写文件（红绿都写，作审计合规表记录）
```

- 汇总 JSON 合规表（schema 2）：每次审计累计全部文本节点的对比度比率直方图
  （WCAG 分桶 `<3` / `3-4.5` / `4.5-7` / `>=7`），与每场景 elements/failures 一起
  经 `--json` 导出（`-` = stdout；红绿都写）。`contrast-summary.json` 基线同 schema，
  可直接 diff 历史版本看分布漂移。
- 排除清单审计账：每场景打印 `skipped tooltip/svg/term/input/hidden/small/offscreen`
  计数，被 SKIP 规则排除的每个文本节点都记账 —— 终端/输入是设计上不属皮肤断言
  范围；`svg` 与 `tooltip` 计数受场景断言约束（见下），不能无声增长。
- 场景契约断言（防真实表面被排除规则吞掉）：`rail_peek` 必须比 `rail_icon` 多审计
  ≥3 个文本元素（peek 浮层恢复的行标签是真实交互表面——被 `[role=tooltip]` 之类
  规则排除会让差距消失即红）；任何场景 `skipped.svg > 0`（图标/徽章里藏文字）或
  `skipped.tooltip > 0`（静态场景上开着瞬时提示）即红，附具体场景与原因。
- 元素覆盖快照：每次全量审计把每场景 elements/failures 与仓库基线
  `docs/dshell-skin-shots/contrast-summary.json` 对比 —— 基线里某场景本次未审计
  （SCENES 被删/改名）或 elements < 基线（文本节点变少）即 rc1；新场景只提示
  （`--update-snapshot` 纳入基线）。防止元素覆盖率悄悄下滑。
- 刷新基线：`pnpm test:dshell:contrast --update-snapshot`（需全量绿跑：0 失败且每场景
  ≥1 元素；失败/零元素状态拒绝写入）。基线与像素基线同纪律：harness 种子下生成并提交，
  CI dispatch `refresh-dshell-baselines=true` 时一并重拍并上传 artifact。
- 退出码：0 全绿（≥1 元素、0 失败、覆盖无下滑）/ 1 对比度失败、场景加载失败或覆盖下滑
  / 2 用法/IO 错误。`--no-snapshot-check` 跳过对比（对非 harness 实例做临时审计时用）。
