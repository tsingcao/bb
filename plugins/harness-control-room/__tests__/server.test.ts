import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * P3 适配层测试：/api/harness/skills 把上游 /api/experience/assets 的
 * 规则卡透传为 promoted 目录（harness 为唯一真源，bb 侧只做只读适配）。
 */

const routes = new Map<string, (req: Request) => Promise<Response>>();

const bb = {
  log: { info: () => {}, warn: () => {} },
  http: {
    route(method: string, path: string, handler: (req: Request) => Promise<Response>) {
      if (method === "GET") routes.set(path, handler);
    },
  },
} as unknown as BbPluginApi;

const originalFetch = globalThis.fetch;

function mockUpstream(status: number, body: unknown) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  routes.clear();
});

async function loadServer() {
  const mod = await import("../src/server.js");
  await mod.default(bb);
}

describe("harness-control-room /api/harness/skills (P3)", () => {
  it("注册了 status/health/runs/signals/skills 五条路由", async () => {
    await loadServer();
    expect(routes.has("/api/harness/status")).toBe(true);
    expect(routes.has("/api/harness/health")).toBe(true);
    expect(routes.has("/api/harness/runs")).toBe(true);
    expect(routes.has("/api/harness/signals")).toBe(true);
    expect(routes.has("/api/harness/skills")).toBe(true);
  });

  it("skills 路由把上游 assets 过滤为 promoted 目录", async () => {
    await loadServer();
    mockUpstream(200, {
      assets: [
        { rule_id: "exp-0001", rule_text: "a", status: "promoted", verified: true, blast_radius: { files: 1, lines: 8 } },
        { rule_id: "exp-0002", rule_text: "b", status: "promoted", verified: false, blast_radius: null },
        { rule_id: "exp-0003", rule_text: "c", status: "draft", verified: false, blast_radius: null },
      ],
    });
    const handler = routes.get("/api/harness/skills")!;
    const res = await handler(new Request("http://x/api/harness/skills"));
    const data = (await res.json()) as {
      ok: boolean;
      catalog: { total: number; promoted: number; rules: Array<{ rule_id: string }> };
    };
    expect(data.ok).toBe(true);
    expect(data.catalog.total).toBe(3);
    expect(data.catalog.promoted).toBe(2);
    expect(data.catalog.rules.map((r) => r.rule_id)).toEqual(["exp-0001", "exp-0002"]);
  });

  it("上游异常时返回 502 而非崩溃", async () => {
    await loadServer();
    mockUpstream(500, { detail: "boom" });
    const handler = routes.get("/api/harness/skills")!;
    const res = await handler(new Request("http://x/api/harness/skills"));
    expect(res.status).toBe(502);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(false);
  });
});
