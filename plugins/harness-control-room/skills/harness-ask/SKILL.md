---
name: harness-ask
description: Drive a NextLoop Harness session from bb — create a session, send a prompt, and read back the assistant reply — through the harness-chat plugin RPC bridge. Use whenever the user wants bb to delegate a task to the Harness loop or converse with a Harness session.
---

# Asking the Harness from bb

bb drives the Harness through the `harness-chat` plugin, which proxies the
sessions API over RPC. The HTTP surface below is the plugin's own RPC HTTP
route (exact-match routing; the path is fixed).

## Create a session

```sh
curl -s -X POST \
  http://127.0.0.1:18154/api/v1/plugins/harness-chat/http/rpc \
  -H 'Content-Type: application/json' \
  -d '{"method":"createSession","input":{"goal":"<goal text>"}}'
```

## Send a prompt and read the reply

```sh
curl -s -X POST \
  http://127.0.0.1:18154/api/v1/plugins/harness-chat/http/rpc \
  -H 'Content-Type: application/json' \
  -d '{"method":"sendPrompt","input":{"session_id":"<session_id>","text":"<prompt>"}}'
```

Then fetch the authoritative history (the loop runs a turn asynchronously;
wait for it to settle before reading):

```sh
curl -s -X POST \
  http://127.0.0.1:18154/api/v1/plugins/harness-chat/http/rpc \
  -H 'Content-Type: application/json' \
  -d '{"method":"history","input":{"session_id":"<session_id>"}}'
```

## Contract

- `createSession` returns `{ session_id }`; keep it for later prompts.
- `sendPrompt` returns `{ session_id, status: "running" }` — the turn is
  asynchronous. Poll `history` (a couple of seconds apart) until the last
  message's `role` is `assistant` and the content is non-empty.
- History messages carry `role` (`user` / `assistant` / `tool`) and `content`.
  Surface tool messages in code style; summarize the final assistant answer.
- RPC input/output are JSON-round-tripped by the host — always send
  `{"method": ..., "input": ...}`.
