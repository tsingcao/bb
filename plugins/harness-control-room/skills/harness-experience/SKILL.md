---
name: harness-experience
description: Consult the NextLoop experience corpus — promoted rule cards, the signal leaderboard, and the industry comparison — as canonical context before writing code or deciding. Use whenever a task overlaps a domain the harness has already learned (api_gateway, workflow, memory, …), or when the user wants the work aligned with verified past outcomes.
---

# Consulting Harness experience

The Harness accumulates verified experience in
`.nextloop/experience/` (workspace side) — rule cards promoted from failure
post-mortems, an experience leaderboard, and an industry comparison. The
`harness-control-room` plugin proxies it read-only.

## Where to look

```sh
# canonical skill/experience catalog (promoted rules + counts)
curl -s http://127.0.0.1:18154/api/v1/plugins/harness-control-room/http/api/harness/skills
# signal summary (leaderboard/industry verdicts)
curl -s http://127.0.0.1:18154/api/v1/plugins/harness-control-room/http/api/harness/signals
# the raw corpus files (if you have workspace access)
.nextloop/experience/skill_library.json
.nextloop/experience/leaderboard_report.json
```

## Contract

- The `/skills` catalog lists **promoted** rules (`status: promoted`,
  `verified: true`) with their rule text, cluster size, and replay stats.
  A rule with `fired > 0` and `contradict == 0` is a strong prior — apply it.
- When a task maps to a family that appears in the signals summary, align the
  approach with the family's positive verdicts and explicitly avoid the
  negative ones. Quote the rule id (`exp-xxxx`) in your reasoning.
- The catalog is generated data, not code — never edit it; treat it as a
  read-only knowledge base.
