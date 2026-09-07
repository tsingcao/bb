# DSH 皮肤 — 6 个工作流的提交归属清单

> 目的：把 nextloop/ide-base 上的 dshell 工作按 6 个工作流归口——**终端主题 /
> 玻璃动画 / 性能护栏 / 快照 gate / overlay peek / 单测**——列出每个流的已提交 commit
> 与当前未提交残留，供评审、对齐（gitlink 升降）与并发流分工引用。
>
> 范围：`0b8ef003e`（DSH 皮肤起点）→ `7740e0903`（本清单落库时的分支 HEAD）。
> 提交数据截至 2026-09-07；未提交残留以落库时工作区为准，后续变化以 `git status` 为准。
> 同一提交可能跨流（已标注），排除 `b81636dcb`（harness/MCP 流，非 dshell）。

## 0. 提交全景（新 → 旧）

| SHA | 日期 | 流 | 提交 |
|---|---|---|---|
| `7740e0903` | 09-07 | 终端主题 / 快照 gate | feat(dshell): 快照场景族收口——app_terminal 通用终端场景 + gallery/audit 基建 |
| `081898355` | 09-06 | 快照 gate | docs(dshell-skin): 快照复现/玻璃 chrome 门调用进 README + test:dshell:snapshot:gallery 别名 |
| `0b8478229` | 09-06 | overlay peek | test(dshell): 命令面板 railToggle 行可见性覆盖——标题/分组/快捷键药丸 + 点击激活 |
| `e099dbded` | 09-06 | overlay peek | feat(dshell): 键盘设置用户可见文案收口到 keyboard-settings-messages 字典接缝 |
| `a60f19ef4` | 09-06 | overlay peek | feat(dshell): tooltip 快捷键药丸统一为 modifier-hold——按住 ⌘/Ctrl 显示、松开显示引导行 |
| `310a0a407` | 09-06 | overlay peek | test(dshell): rail 契约测试增量——sidebar.toggle 对称 handler 覆盖 + ⌘⇧\ 真实键盘集成 |
| `b1fce128f` | 09-06 | overlay peek | test(dshell): 锁定 rail 单向不变式——rail 开着时允许关闭侧栏，重开仍回 icon rail |
| `a13788c2b` | 09-06 | overlay peek | test(dshell): ⌘⇧\ railToggle 命令面板端到端——rail 往返 + aria/chevron 同步 |
| `35b22a250` | 09-06 | overlay peek | feat(dshell): rail 触发钮 ⌘⇧\ 快捷键药丸 + tooltip 双命令提示 + i18n 接缝 |
| `12a1ebdd8` | 09-06 | 快照 gate | ci(dshell): bb 对比度审计（WCAG）——8 主表面场景接进快照 workflow |
| `5a42eb3a3` | 09-06 | 快照 gate | test(dshell): 迁移横幅场景进快照 gate——auto 基线 + 文档/图册 |
| `0813e4a58` | 09-06 | 单测 | feat(dshell): 迁移横幅仅 ✕ 关闭持久化——Open settings 纯导航保持可发现 |
| `da4cd4b25` | 09-06 | 单测 | ci(dshell): dshell 单元测试 gate——test:dshell:unit 本地与 CI 同一入口 |
| `31098cb99` | 09-06 | 单测 | feat(dshell): 跨标签页同步补齐 active 通知并补 storage 事件测试 |
| `9da46f33a` | 09-06 | overlay peek | test(dshell): rail_peek 加 no-push 几何断言并修复 --scene rail_* 分发 |
| `3650089e6` | 09-06 | overlay peek | feat(dshell): peek 浮层点击契约——外点立即收起、内点正常导航 |
| `6faa60a74` | 09-06 | 快照 gate / 终端主题 | feat(dshell): wire skin snapshot into CI and cover terminal glass scenes |
| `7fd9c25aa` | 09-05 | 快照 gate | test(dshell): commit auto machine baselines for settings/home/rail scenes |
| `f562d6b1a` | 09-05 | 快照 gate | docs(dshell): gallery rows + runbook for terminal canvas and auto snapshots |
| `7e48493b2` | 09-05 | 玻璃动画 | feat(dshell): extend panel glass to the compact drawer shelf (≤767px) |
| `1dfbf8fb8` | 09-05 | 性能护栏 | feat(dshell): downgrade glass on terminal output bursts via rAF watchdog |
| `2e2d85f9c` | 09-05 | 性能护栏 | test(dshell): add panel scroll perf bench with three-state worst-frame caps |
| `1c8c2bff1` | 09-05 | 终端主题 | feat(dshell): generalize the terminal canvas chrome to every terminal host |
| `c19563319` | 09-05 | 玻璃动画 | feat(dshell): keep panel-root glass across ⌘J collapse and divider drags |
| `dea0693b9` | 09-05 | 终端主题 | feat(app): theme the xterm canvas from DSH tokens under the dshell skin |
| `3b8d15580` | 09-05 | 快照 gate | test(dshell-skin): add per-tab glass chrome scenes to the snapshot suite |
| `59abb379a` | 09-05 | 快照 gate | docs(dshell-skin): archive tool-tab glass audit with light variants |
| `3f1071a3d` | 09-05 | 单测 | feat(app): one-time migration banner for legacy DSH users |
| `9104bb3f0` | 09-05 | 单测 | feat(app): seed DSH skin to auto for dark-mode first visits |
| `016612d13` | 09-05 | overlay peek | feat(app): rail hover-peek overlays instead of pushing content |
| `25daac95e` | 09-05 | overlay peek | feat(app): register sidebar.railToggle (icon rail) as a command with a shortcut |
| `ffb323767` | 09-05 | 单测 | feat(app): make the DSH skin opt-in and tri-state (original/follow-appearance/always) |
| `0b8ef003e` | 09-05 | 皮肤地基 | feat(app): add DSH/NEXTLoop blueprint-glass skin with icon-rail sidebar |

## 1. 终端主题（xterm 画布 + 终端 chrome）

- 契约面：`apps/app/src/components/thread/terminal/ThreadTerminalView.tsx`（`applyDshellTerminalTheme`）、
  `apps/app/src/components/ui/dshell/dshell.css` 第 12 段（`--dsh-term-*` / `--dsh-ansi-0..15`、
  `[data-app-terminal]` 通用终端 chrome）。
- 已提交：`dea0693b9`、`1c8c2bff1`、`7740e0903`（app_terminal 场景；跨流含快照 gate）。
- 未提交残留：`scripts/dshell-term-color-audit.py`（untracked，色值审计工具）。

## 2. 玻璃动画（⌘J 折叠 / 分栏拖拽 / 紧凑抽屉）

- 契约面：`dshell.css` 第 11 段（`[data-panel-id="thread-detail-secondary-panel"]` 玻璃链、
  `--panel-collapse-duration`）、`scripts/dshell-skin-snapshot.py` 的 `glass_anim` 帧采样场景。
- 已提交：`c19563319`、`7e48493b2`。
- 未提交残留：`dshell.css`（M，与性能护栏/并发流共改同一文件）。

## 3. 性能护栏（滚动 / 终端输出突发降级）

- 契约面：`apps/app/src/lib/dshell-panel-perf.ts`（BurstFrameStateMachine、rAF 空闲检测、
  blur 22px→6px 降级）、`scripts/dshell-panel-perf-bench.py`（三态帧率基准）。
- 已提交：`2e2d85f9c`（bench 三态 worst-frame caps）、`1dfbf8fb8`（burst rAF watchdog）。
- 未提交残留：`apps/app/src/lib/dshell-panel-perf.ts`（M）。

## 4. 快照 gate（headless 像素回归 + CI 接线 + 对比度审计）

- 契约面：`scripts/dshell-skin-snapshot.py`、`scripts/dshell_contrast_audit.py`、
  `.github/workflows/dshell-skin-snapshot.yml`、`docs/dshell-skin-shots/auto/` 机器基线、
  `docs/dshell-skin-shots/audit.json`、`gallery.html` 与 `*.png` 图册。
- 已提交：`3b8d15580`、`59abb379a`、`f562d6b1a`、`7fd9c25aa`、`6faa60a74`、`5a42eb3a3`、
  `12a1ebdd8`、`081898355`（+`7740e0903` 的 gallery/audit 基建）。
- 未提交残留：`scripts/dshell-skin-snapshot.py`（M）、`docs/dshell-skin-shots/audit.json`（??）、
  `docs/dshell-skin-shots/host-compare/`（??）、`scripts/dshell-host-compare.py`（??）、
  `docs/dshell-skin-shots/glass_tab_*.png` 16 张（M，tool-tab 审计重拍）、
  `.github/workflows/dshell-skin-snapshot.yml`（M，本会话新增 coverage 上传 / 别名守卫 /
  单测 gate 步骤）。

## 5. overlay peek（rail 浮层 + 命令/快捷键 + no-push 契约）

- 契约面：`apps/app/src/components/ui/sidebar.tsx`（peek 浮层覆盖、`data-rail-peek`）、
  `apps/app/src/components/sidebar/SidebarRailToggle.tsx`、`apps/app/src/components/layout/AppLayout.tsx`
  （rail atom + ⌘⇧\ handler）、`apps/app/src/lib/sidebar-messages.ts`、`app-keybindings.ts`、
  命令面板条目；`dshell-skin-snapshot.py` 的 `rail_peek` 场景 + no-push 几何断言。
- 已提交：`25daac95e`、`016612d13`、`3650089e6`、`9da46f33a`、`35b22a250`、`a13788c2b`、
  `b1fce128f`、`310a0a407`、`a60f19ef4`、`e099dbded`、`0b8478229`。
- 未提交残留：无（该流代码已全量落库）。

## 6. 单测（dshell 契约单测 + 单测 gate）

- 契约面：8 个套件——`src/lib/dshell.test.ts`、`dshell-migration.test.ts`、
  `dshell-panel-perf.test.ts`、`src/components/settings/DshellAppearanceSetting.test.tsx`、
  `DshellMigrationBanner.test.tsx`、`src/components/ui/sidebar.test.tsx`、
  `src/components/sidebar/SidebarRailToggle.test.tsx`、
  `src/components/layout/AppLayout.sidebar-rail.test.tsx`；入口 `apps/app/package.json`
  `test:dshell:unit`（含 `--coverage`，reportsDirectory `coverage/dshell-unit`）；
  turbo 任务 `turbo.json test:dshell:unit` + ci.yml `dshell-unit` 分片；
  守卫 `scripts/check-dshell-unit-scope.mjs`（别名↔app 分片覆盖 + 提交树存在性）。
- 已提交：`ffb323767`（opt-in 三态契约）、`9104bb3f0`（auto seed）、`3f1071a3d` +
  `0813e4a58`（迁移横幅）、`31098cb99`（跨标签页同步）、`e3067869e`（auto-mode .dark flip）、
  `da4cd4b25`（单测 gate）。
- 未提交残留：`apps/app/src/lib/dshell.test.ts`（M，storage 未知字符串边界用例）、
  `apps/app/package.json`（M，`--coverage` 别名）、`turbo.json`（M，`test:dshell:unit` 任务）、
  `.github/workflows/ci.yml`（M，`dshell-unit` 分片）、`scripts/check-dshell-unit-scope.mjs`（??）。

## 7. 维护纪律

- **新增 dshell 族测试**（`src/lib/dshell*` / `settings/Dshell*` / rail 三件套）必须进
  `test:dshell:unit` 别名——`check-dshell-unit-scope.mjs` 会同时拦「漏加」与「引用未提交
  文件」两个方向。
- **改皮肤 CSS/基线**：`dshell.css` 与 `docs/dshell-skin-shots/` 被多流共改，动前先查本节
  归属；基线 `--update` 重拍按流收口提交，避免与并发流互相追赶。
- **gitlink 升降**：对齐评审以 §0 全景表 + 当前 `git status` 为准，逐流核对已提交/残留。