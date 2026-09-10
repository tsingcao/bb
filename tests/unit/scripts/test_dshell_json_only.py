"""dshell-skin-snapshot.py 的 --json-only 离线重放单测。

镜像 test_dshell_gallery_audit.py 的模式：importlib 加载真实脚本（上线代码而非
复制品），CLI 走 ``_json_only_replay(argv)`` 本体，tmp_path 隔离，断言真实退出码。
不启动 Playwright：--json-only 在模块自举前拦截，纯 stdlib。

覆盖矩阵：
* happy path：合法记录 → audit.json 原样重放（结构 == 真实运行写出的形状）+ rc0；
* 记录缺失 → rc2；JSON 不可解析 → rc2；schema 字段不符 → rc2；
* 记录里 audit 为空对象仍可重放（真实运行零场景归档时的形状）；
* happy path 的 stdout 摘要含 FAIL/SKIP 计数与 exit code（人工审阅入口）；
* _write_last_run_record 的落盘契约：全量运行写记录、单场景不写、空运行不覆盖、
  崩溃留档（exit 70 + 已跑场景的部分数据）、audit 字段 == AUDIT 本体。
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "dshell-skin-snapshot.py"

_spec = importlib.util.spec_from_file_location("dshell_skin_snapshot_jsononly_ut", _SCRIPT)
snap = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(snap)


def _record(**overrides) -> dict:
    """构造一份 schema 1 的合法运行记录（形状 == _write_last_run_record 的产物）。"""
    base = {
        "schema": 1,
        "recordedAt": "2026-09-09T12:00:00+00:00",
        "mode": "--check",
        "ci": True,
        "url": "http://127.0.0.1:41999",
        "audit": {
            "glass_dark_terminal": {"theme": "dark", "chromeBg": "rgba(8,11,18,0.58)", "pixels": {"n": 4704, "darkPct": 96.0, "lightPct": 0.0}},
            "rail_icon": {"theme": "dark", "pixels": {"n": 100, "darkPct": 50.0, "lightPct": 50.0}},
        },
        "summary": {
            "failures": ["glass_dark_terminal/chrome_left: mean=2.10 diffPx=1.20%"],
            "skips": ["glass_anim ⌘J/拖拽帧采样（无线程）"],
            "consoleErrors": ["TypeError: cannot read properties of undefined"],
            "exitCode": 1,
        },
    }
    base.update(overrides)
    return base


@pytest.fixture()
def paths(tmp_path):
    last_run = tmp_path / ".last-run.json"
    out = tmp_path / "audit.json"
    return last_run, out


def _replay(paths, *extra: str):
    last_run, out = paths
    argv = ["--json-only", "--last-run", str(last_run), "--out", str(out), *extra]
    return snap._json_only_replay(argv), capsys_text()


def capsys_text() -> str:
    import contextlib
    import io

    return ""  # stdout 捕获由 capsys fixture 在各测试内完成（见下）


def test_happy_path_replays_audit_verbatim(paths, capsys):
    last_run, out = paths
    rec = _record()
    last_run.write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")

    rc = snap._json_only_replay(["--json-only", "--last-run", str(last_run), "--out", str(out)])
    text = capsys.readouterr().out

    assert rc == 0
    assert out.exists()
    replayed = json.loads(out.read_text(encoding="utf-8"))
    assert replayed == rec["audit"]  # audit 字段原样重放，无加工
    assert set(replayed["glass_dark_terminal"]) == {"theme", "chromeBg", "pixels"}
    # 摘要行供人工审阅：FAIL/SKIP 计数 + 上次退出码 + 数据来源
    assert "FAIL=1" in text and "SKIP=1" in text and "exit=1" in text
    assert "recordedAt=2026-09-09T12:00:00+00:00" in text
    assert ".last-run.json" in text


def test_missing_record_rc2(paths):
    last_run, out = paths
    rc = snap._json_only_replay(["--json-only", "--last-run", str(last_run), "--out", str(out)])
    assert rc == 2
    assert not out.exists()


def test_unparsable_record_rc2(paths):
    last_run, out = paths
    last_run.write_text("{not json", encoding="utf-8")
    rc = snap._json_only_replay(["--json-only", "--last-run", str(last_run), "--out", str(out)])
    assert rc == 2
    assert not out.exists()


def test_wrong_schema_rc2(paths):
    last_run, out = paths
    rec = _record(schema=2)
    last_run.write_text(json.dumps(rec), encoding="utf-8")
    rc = snap._json_only_replay(["--json-only", "--last-run", str(last_run), "--out", str(out)])
    assert rc == 2
    # 非 dict 记录同样拒绝
    last_run.write_text("[1, 2]", encoding="utf-8")
    assert snap._json_only_replay(["--json-only", "--last-run", str(last_run), "--out", str(out)]) == 2
    assert not out.exists()


def test_empty_audit_still_replays(paths):
    last_run, out = paths
    rec = _record(audit={}, summary={"failures": [], "skips": ["全部场景跳过"], "consoleErrors": [], "exitCode": 0})
    last_run.write_text(json.dumps(rec), encoding="utf-8")
    rc = snap._json_only_replay(["--json-only", "--last-run", str(last_run), "--out", str(out)])
    assert rc == 0
    assert json.loads(out.read_text(encoding="utf-8")) == {}


def test_extra_args_are_ignored_with_notice(paths, capsys):
    last_run, out = paths
    last_run.write_text(json.dumps(_record()), encoding="utf-8")
    # 复用真实命令形态：--check 等无关参数被忽略而不是报错（重放模式不跑场景）
    rc = snap._json_only_replay(["--json-only", "--check", "--ci", "--last-run", str(last_run), "--out", str(out)])
    assert rc == 0
    assert "--check" in capsys.readouterr().err


# --- _write_last_run_record 的落盘契约 ---


@pytest.fixture()
def run_state(tmp_path, monkeypatch):
    """脚本全局量指到 tmp 工作区，测后恢复。"""
    monkeypatch.setattr(snap, "GALLERY_DIR", tmp_path)
    monkeypatch.setattr(snap, "LAST_RUN_PATH", tmp_path / ".last-run.json")
    snap.AUDIT.clear()
    snap.failures.clear()
    snap.skips.clear()
    snap.CONSOLE_ERRORS.clear()
    snap._RUN_META.clear()
    yield tmp_path
    snap.AUDIT.clear()
    snap.failures.clear()
    snap.skips.clear()
    snap.CONSOLE_ERRORS.clear()
    snap._RUN_META.clear()


def test_record_written_for_full_run_and_replay_roundtrip(run_state, capsys):
    tmp = run_state
    snap._RUN_META.update(scene=None, ci=True, url="http://127.0.0.1:41999")
    snap.AUDIT.update({"rail_icon": {"theme": "dark", "pixels": {"n": 100}}})
    snap.failures.append("rail_icon/chrome: 偏差")
    snap.skips.append("glass_anim（无线程）")

    snap._write_last_run_record(1)

    rec = json.loads((tmp / ".last-run.json").read_text(encoding="utf-8"))
    assert rec["schema"] == 1
    assert rec["audit"] == {"rail_icon": {"theme": "dark", "pixels": {"n": 100}}}
    assert rec["summary"]["failures"] == ["rail_icon/chrome: 偏差"]
    assert rec["summary"]["exitCode"] == 1
    assert rec["ci"] is True
    assert rec["recordedAt"].endswith("+00:00")
    # 落盘 → 重放 往返：audit.json 与 AUDIT 本体一致
    rc = snap._json_only_replay(
        ["--json-only", "--last-run", str(tmp / ".last-run.json"), "--out", str(tmp / "audit.json")]
    )
    assert rc == 0
    assert json.loads((tmp / "audit.json").read_text(encoding="utf-8")) == rec["audit"]


def test_record_skipped_for_single_scene_run(run_state):
    snap._RUN_META.update(scene="rail_icon", ci=False, url="http://127.0.0.1:41999")
    snap.AUDIT.update({"rail_icon": {"theme": "dark"}})
    snap._write_last_run_record(0)
    assert not (run_state / ".last-run.json").exists()


def test_record_not_overwritten_by_empty_run(run_state):
    tmp = run_state
    snap._RUN_META.update(scene=None, ci=False, url="x")
    snap._write_last_run_record(2)
    assert not (tmp / ".last-run.json").exists()
    # 已有记录不被零输出运行覆盖
    (tmp / ".last-run.json").write_text(json.dumps(_record()), encoding="utf-8")
    snap._write_last_run_record(2)
    assert json.loads((tmp / ".last-run.json").read_text(encoding="utf-8"))["schema"] == 1


def test_crash_leaves_partial_record(run_state):
    """崩溃留档：exit 70 + 已跑场景的部分数据（--json-only 审阅的正是这种残缺形态）。"""
    tmp = run_state
    snap._RUN_META.update(scene=None, ci=False, url="http://127.0.0.1:41999")
    snap.AUDIT.update({"final_dark_home": {"theme": "dark"}})  # 崩溃前已跑完的场景

    snap._write_last_run_record(70)

    rec = json.loads((tmp / ".last-run.json").read_text(encoding="utf-8"))
    assert rec["summary"]["exitCode"] == 70
    assert "final_dark_home" in rec["audit"]
