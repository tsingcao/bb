import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * Harness Chat — host 侧插件（接缝 A：bb 线程 ↔ harness sessions API）。
 *
 * RPC（POST /api/v1/plugins/harness-chat/rpc/<method>）：
 *  - createSession(goal?)   → { session_id }
 *  - sendPrompt(sessionId, text) → { ok }
 *  - history(sessionId)     → { messages }
 *
 * 透传到 8765（NEXTLOOP_WEB_URL），token 由环境注入；bb 侧不持久化任何
 * harness 状态（接缝契约 §6）。
 */

const HARNESS_URL = process.env.NEXTLOOP_WEB_URL ?? "http://127.0.0.1:8765";
const HARNESS_TOKEN = process.env.NEXTLOOP_WEB_TOKEN ?? "";

export const harnessChatRpcContract = defineRpcContract({
  createSession: {
    input: z.object({ goal: z.string().optional() }),
    output: z.object({ session_id: z.string(), status: z.string() }),
  },
  sendPrompt: {
    input: z.object({ session_id: z.string(), text: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  history: {
    input: z.object({ session_id: z.string() }),
    output: z.object({ messages: z.array(z.unknown()) }),
  },
});

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (HARNESS_TOKEN) h.authorization = `Bearer ${HARNESS_TOKEN}`;
  return h;
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("harness-chat loaded");

  bb.rpc.register(harnessChatRpcContract, {
    async createSession({ goal }) {
      const res = await fetch(`${HARNESS_URL}/api/sessions`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ goal: goal ?? "" }),
      });
      if (!res.ok) throw new Error(`harness createSession ${res.status}`);
      const body = (await res.json()) as { session_id: string; status: string };
      return body;
    },

    async sendPrompt({ session_id, text }) {
      const res = await fetch(`${HARNESS_URL}/api/sessions/${encodeURIComponent(session_id)}/prompt`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ text }),
      });
      return { ok: res.ok };
    },

    async history({ session_id }) {
      const res = await fetch(`${HARNESS_URL}/api/sessions/${encodeURIComponent(session_id)}/history?limit=200`, {
        headers: headers(),
      });
      if (!res.ok) throw new Error(`harness history ${res.status}`);
      const body = (await res.json()) as { messages: unknown[] };
      return { messages: body.messages ?? [] };
    },
  });
}
