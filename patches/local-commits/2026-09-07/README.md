# 本地仅有的 5 个提交 —— patch 归档（2026-09-07）

本目录归档 bb-fork `nextloop/ide-base` 上**仅本地存在、未推上 fork 远端**的 5 个提交
（`6faa60a74..da4cd4b25`），供无 workflow scope / 需人工合入时使用。

## 范围与基线

| 项 | 值 |
|---|---|
| 基线（base） | `7fd9c25aa`（= fork 远端 tip `fork/nextloop/ide-base`，GitHub 可拉到） |
| 范围 | `7fd9c25aa..da4cd4b25`，共 5 个提交（含两端） |
| 校验 | 已在基线做 `git am` 顺序应用，重建 tree 与 `da4cd4b25` 完全一致（tree `e313716ac…`） |

## 提交清单（按应用顺序）

| # | 文件 | 提交 |
|---|---|---|
| 0001 | `0001-feat-dshell-…-ter.patch` | `6faa60a74` feat(dshell): wire skin snapshot into CI and cover terminal glass scenes |
| 0002 | `0002-feat-dshell-peek.patch` | `3650089e6` feat(dshell): peek 浮层点击契约——外点立即收起、内点正常导航 |
| 0003 | `0003-test-dshell-rail_peek-no-push-scene-rail_.patch` | `9da46f33a` test(dshell): rail_peek 加 no-push 几何断言并修复 --scene rail_* 分发 |
| 0004 | `0004-feat-dshell-active-storage.patch` | `31098cb99` feat(dshell): 跨标签页同步补齐 active 通知并补 storage 事件测试 |
| 0005 | `0005-ci-dshell-dshell-gate-test-dshell-unit-CI.patch` | `da4cd4b25` ci(dshell): dshell 单元测试 gate——test:dshell:unit 本地与 CI 同一入口 |
| – | `combined-local-5.mbox` | 以上 5 份合并为单一 mbox（顺序一致） |

> 注意：0003 与 0005 依赖前序补丁（改动同一批文件），**必须按顺序应用**，不能单独对基线
> `git apply`。0001–0002 可对基线独立应用。

## 人工合入方法

在任意基于 `7fd9c25aa`（或其后续）的 checkout 上：

```sh
# 带提交元数据（作者/日期/消息），自动按顺序逐个提交
git am patches/local-commits/2026-09-07/000*.patch

# 或只合入其中某几个（先保证前序已入）
git am patches/local-commits/2026-09-07/0001-feat-dshell-…-ter.patch \
        patches/local-commits/2026-09-07/0002-feat-dshell-peek.patch

# 或只取改动、不提交（按序 apply 到工作区）
git apply patches/local-commits/2026-09-07/0001-*.patch
git apply patches/local-commits/2026-09-07/0002-*.patch
# 0003 起需前序已应用，否则用 am
```

若要跳过作者/日期（改挂在自己名下提交）：

```sh
git am --committer-date-is-author-date  # 默认
git am --no-commit 000*.patch           # 逐个 apply 到 index 后自行 commit
```

## 完整性校验（复验）

```sh
git worktree add /tmp/verify 7fd9c25aa
(cd /tmp/verify && git am /path/to/patches/local-commits/2026-09-07/000*.patch)
test "$(git -C /tmp/verify rev-parse HEAD^{tree})" = \
     "$(git -C /Users/timcao/workspace/nextloop/bb-fork rev-parse da4cd4b25^{tree})"
git worktree remove --force /tmp/verify
```

tree 相等即证明归档完整、可无损失重建 `da4cd4b25` 内容。