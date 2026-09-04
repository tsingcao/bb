import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * Harness Control Room — host 侧插件。
 *
 * 职责（接缝 B：bb 外壳 ↔ 8765 FastAPI）：
 *  1. `GET /api/harness/status`：轻量状态探针（needs-you 徽章）。
 *  2. `GET /api/harness/health`：可达性探针。
 *  3. `GET /api/harness/runs`：透传 agent-runs 摘要（Query/监测面板数据源）。
 *  4. `GET /api/harness/signals`：透传经验信号（监测 tab 数据源）。
 *
 * 注：插件 HTTP 路由为精确匹配（不支持 `*`/`:param`），故以显式路由替代
 * 通用反向代理；iframe 直连 8765（主仓 CORS 已放行 bb 源）承担完整 UI。
 *
 * 接缝契约（docs/design/harness_ide_vendor.md §6）：bb = UI 外壳，
 * Harness = 后端真源；本插件只做透传与形态适配，不持久化 harness 状态。
 */

const DEFAULT_HARNESS_URL = process.env.NEXTLOOP_WEB_URL ?? "http://127.0.0.1:8765";
const HARNESS_TOKEN = process.env.NEXTLOOP_WEB_TOKEN ?? "";

interface HarnessStatus {
  ok: boolean;
  url: string;
  pending: number;
  error?: string;
}

function harnessHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (HARNESS_TOKEN) headers.authorization = `Bearer ${HARNESS_TOKEN}`;
  return headers;
}

async function fetchJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${DEFAULT_HARNESS_URL}${path}`, { headers: harnessHeaders() });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("harness-control-room loaded");

  // GET /api/harness/status —— needs-you 徽章数据源
  bb.http.route("GET", "/api/harness/status", async () => {
    try {
      const { status, body } = await fetchJson("/api/hitl/pending");
      let pending = 0;
      if (status === 200 && body && typeof body === "object") {
        const pendingList = (body as { pending?: unknown[] }).pending;
        pending = Array.isArray(pendingList) ? pendingList.length : 0;
      }
      const out: HarnessStatus = { ok: status < 500, url: DEFAULT_HARNESS_URL, pending };
      return Response.json(out, { status: status < 500 ? 200 : 502 });
    } catch (err) {
      const out: HarnessStatus = {
        ok: false,
        url: DEFAULT_HARNESS_URL,
        pending: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      return Response.json(out, { status: 502 });
    }
  });

  // GET /api/harness/health —— 可达性探针
  bb.http.route("GET", "/api/harness/health", async () => {
    try {
      const { status, body } = await fetchJson("/api/health");
      return Response.json({ ok: status === 200, upstream: DEFAULT_HARNESS_URL, health: body });
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }
  });

  // GET /api/harness/runs —— agent-runs 摘要（Query/监测面板）
  bb.http.route("GET", "/api/harness/runs", async () => {
    try {
      const { status, body } = await fetchJson("/api/agent-runs");
      return Response.json({ ok: status === 200, runs: body });
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }
  });

  // GET /api/harness/skills —— 经验目录（P3：harness 为唯一真源的 skill 适配层）
  bb.http.route("GET", "/api/harness/skills", async () => {
    try {
      const { status, body } = await fetchJson("/api/experience/assets?limit=100");
      if (status !== 200) {
        return Response.json({ ok: false, error: `upstream ${status}` }, { status: 502 });
      }
      const assets = (body as { assets?: unknown[] }).assets ?? [];
      const promoted = assets.filter(
        (a) => (a as { status?: string; verified?: boolean }).status === "promoted",
      );
      const catalog = {
        ok: true,
        catalog: {
          total: assets.length,
          promoted: promoted.length,
          rules: promoted.map((a) => ({
            rule_id: (a as { rule_id?: string }).rule_id,
            rule_text: (a as { rule_text?: string }).rule_text,
            verified: (a as { verified?: boolean }).verified,
            blast_radius: (a as { blast_radius?: unknown }).blast_radius,
          })),
        },
      };
      return Response.json(catalog);
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }
  });

  // GET /api/harness/signals —— 经验信号（监测 tab）
  bb.http.route("GET", "/api/harness/signals", async () => {
    try {
      const { status, body } = await fetchJson("/api/experience/signals");
      return Response.json({ ok: status === 200, signals: body });
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }
  });

  // 初始化探针
  try {
    const res = await fetch(`${DEFAULT_HARNESS_URL}/api/health`, { headers: harnessHeaders() });
    bb.log.info(`harness-control-room: Control Room ${res.ok ? "可达" : `异常 ${res.status}`}`);
  } catch (err) {
    bb.log.warn(`harness-control-room: Control Room 不可达（8765 未启动）: ${String(err)}`);
  }
}
