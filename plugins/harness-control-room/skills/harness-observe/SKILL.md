---
name: harness-observe
description: Read the live state of the NextLoop Harness backend (Control Room) — reachability, needs-you queue, recent agent runs, and the experience-signal summary. Use whenever the user asks what the harness is doing, how an agent run ended, whether anything needs attention, or for a health snapshot of the Control Room.
---

# Observing the NextLoop Harness

The Harness backend (Control Room) is a FastAPI service, normally at
`http://127.0.0.1:8765`. The bb plugin `harness-control-room` proxies
read-only views of it through exact HTTP routes on the bb host — prefer the
proxied routes below so you never need the upstream token or CORS.

## Routes (proxied by the plugin, read-only)

```sh
# reachability + needs-you count
curl -s http://127.0.0.1:18154/api/v1/plugins/harness-control-room/http/api/harness/status
# recent agent-run episodes (agent_runs corpus)
curl -s http://127.0.0.1:18154/api/v1/plugins/harness-control-room/http/api/harness/runs
# experience signal summary (leaderboard + industry)
curl -s http://127.0.0.1:18154/api/v1/plugins/harness-control-room/http/api/harness/signals
# canonical skill/experience catalog (promoted rules)
curl -s http://127.0.0.1:18154/api/v1/plugins/harness-control-room/http/api/harness/skills
```

## Contract

- `status.pending` = items waiting for a human decision (needs-you). Non-zero
  means the user should be told something needs attention.
- `runs.episodes[]` carries `exit_status` (`completed` / `max_rounds` /
  `error`), `rounds`, `seconds`, `verified`, `has_advice`. Summarize
  `exit_status` distribution and flag `max_rounds` runs as stuck loops.
- `signals.summary` carries `families`, `records`, `verified_rules`, and a
  `verdicts` breakdown (positive / negative / insufficient).
- All routes are GET only. Observing never mutates harness state; for driving
  sessions use the `harness-ask` skill instead.
