#!/usr/bin/env python3
"""Claude/Cursor 同款 JSON-RPC 握手探测：initialize → tools/list → tools/call。

用法: python3 scripts/probe_mcp.py [base_url]
默认 base_url=http://127.0.0.1:41999/mcp
"""
import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:41999/mcp"


def post(payload: dict, headers=None) -> dict:
    h = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Mcp-Protocol-Version": "2025-03-26",
    }
    if headers:
        h.update(headers)
    req = urllib.request.Request(
        BASE,
        data=json.dumps(payload).encode(),
        headers=h,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = resp.read().decode()
    # 纯通知（如 notifications/initialized）返回 202 空 body
    if not body.strip():
        return {}
    # 传输层默认 SSE 帧（event: message / data: {...}），解析 data 行即可
    data_lines = [
        ln[6:]
        for ln in body.splitlines()
        if ln.startswith("data: ")
    ]
    return json.loads(data_lines[-1]) if data_lines else json.loads(body)


def main() -> int:
    print("=== 1) initialize ===")
    init = post({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "probe", "version": "1.0"},
        },
    })
    print(json.dumps(init, ensure_ascii=False, indent=2))
    if "error" in init:
        print("INIT FAILED:", init["error"])
        return 1

    print("\n=== 2) notifications/initialized ===")
    notif = post({"jsonrpc": "2.0", "method": "notifications/initialized"})
    print("sent (202 空 body)" if notif == {} else f"unexpected: {notif}")

    print("\n=== 3) tools/list ===")
    lst = post({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    tools = (lst.get("result") or {}).get("tools", [])
    print(f"工具数: {len(tools)}")
    for t in tools:
        print(f"  - {t['name']}: {(t.get('description') or '')[:70]}")

    print("\n=== 4) tools/call (query-memory) ===")
    call = post({
        "jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": {"name": "query-memory", "arguments": {"query": "nextloop"}},
    })
    print(json.dumps(call, ensure_ascii=False, indent=2))
    if "error" in call:
        print("CALL FAILED:", call["error"])
        return 1

    print("\n=== 5) tools/call (run-harness-long skill, 2 epochs) ===")
    call2 = post({
        "jsonrpc": "2.0", "id": 4, "method": "tools/call",
        "params": {"name": "run-harness-long", "arguments": {"targetEpoch": 2}},
    })
    print(json.dumps(call2, ensure_ascii=False, indent=2))
    if "error" in call2:
        print("SKILL CALL FAILED:", call2["error"])
        return 1

    print("\n握手往返全部通过 ✔")
    return 0


if __name__ == "__main__":
    sys.exit(main())