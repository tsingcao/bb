#!/usr/bin/env node
// 真发消息级模型可用性验证 — 按厂商分组，并发控制，落盘 verified-models.json
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const BB_SERVER = process.env.BB_SERVER_URL || "http://127.0.0.1:26154";
const CONCURRENCY = 3;
const TIMEOUT_MS = 15000;
const TEST_PROMPT = "ping";

async function fetchJSON(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS + 5000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(()=>"")}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function getModels(providerId) {
  // 通过 system execution-options 拿到该 provider 的模型列表
  const url = providerId
    ? `${BB_SERVER}/api/v1/system/execution-options?providerId=${encodeURIComponent(providerId)}`
    : `${BB_SERVER}/api/v1/system/execution-options`;
  const data = await fetchJSON(url, { headers: { "content-type": "application/json" } });
  return data.models || [];
}

async function testModel(providerId, modelId) {
  // 创建临时线程并发起一次极简对话
  const start = Date.now();
  try {
    // 优先用 acp-opencode 聚合网关时，modelId 已包含前缀如 nvidia/minimax...
    // 直接创建 thread 并发送
    const threadRes = await fetchJSON(`${BB_SERVER}/api/v1/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId,
        model: modelId,
        input: [{ type: "text", text: TEST_PROMPT }],
      }),
    });
    const threadId = threadRes.thread?.id || threadRes.id || threadRes.threadId;
    if (!threadId) throw new Error("no threadId");

    // 轮询 thread timeline 等待 agent 回复
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1200));
      const tl = await fetchJSON(`${BB_SERVER}/api/v1/threads/${encodeURIComponent(threadId)}/timeline`, {
        headers: { "content-type": "application/json" },
      });
      const hasAgent = (tl.items || tl.events || []).some(e =>
        (e.type && String(e.type).includes("agent")) ||
        (e.item && e.item.type && String(e.item.type).includes("agent"))
      );
      // 简化：只要 turn 完成且非错误即认为可用
      const turnCompleted = JSON.stringify(tl).includes("turn/completed");
      if (turnCompleted || hasAgent) {
        return { model: modelId, verified: true, latencyMs: Date.now() - start };
      }
      // 检查是否已 idle 且无错误
      if (JSON.stringify(tl).includes('"status":"idle"')) {
        // 若无 agent 内容则判失败
        if (hasAgent) return { model: modelId, verified: true, latencyMs: Date.now() - start };
      }
    }
    return { model: modelId, verified: false, error: "timeout", latencyMs: Date.now() - start };
  } catch (e) {
    return { model: modelId, verified: false, error: String(e).slice(0,300), latencyMs: Date.now() - start };
  }
}

async function runPool(items, fn, concurrency) {
  const out = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      const item = items[i];
      const res = await fn(item);
      out[i] = res;
      console.log(`[${i+1}/${items.length}] ${res.model} -> ${res.verified ? "✅可用" : "❌不可用"} ${res.latencyMs}ms ${res.error||""}`);
    }
  }
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, () => worker()));
  return out;
}

async function main() {
  const providerId = process.argv[2] || "acp-opencode"; // 默认测聚合网关
  const filterPrefix = process.argv[3] || ""; // 如 nvidia/
  console.log(`🔍 验证 provider=${providerId} filter=${filterPrefix || "(all)"} BB_SERVER=${BB_SERVER}`);

  const models = await getModels(providerId);
  console.log(`📦 拉取到 ${models.length} 个模型`);
  const targets = models
    .map(m => m.model || m.id)
    .filter(id => !filterPrefix || String(id).startsWith(filterPrefix));

  console.log(`🎯 待测 ${targets.length} 个: ${targets.slice(0,5).join(", ")}${targets.length>5?" ...":""}`);

  const results = await runPool(targets, (mid) => testModel(providerId, mid), CONCURRENCY);

  const verified = results.filter(r => r.verified);
  console.log(`\n✅ 已验证可用: ${verified.length}/${results.length}`);
  verified.slice(0,20).forEach(r => console.log("  ✅", r.model));
  console.log(`\n❌ 不可用: ${results.length-verified.length}`);
  results.filter(r=>!r.verified).slice(0,20).forEach(r=>console.log("  ❌", r.model, r.error||""));

  await mkdir(".bb", { recursive: true });
  const outPath = join(".bb", `verified-models-${providerId.replace(/[^a-z0-9]/g,"_")}.json`);
  await writeFile(outPath, JSON.stringify({ providerId, at: new Date().toISOString(), results }, null, 2), "utf-8");
  console.log(`\n💾 已落盘 ${outPath}`);
  // 同时写一份按 isDefault/verified 友好的清单供 UI 读取
  const uiPath = join(".bb", "verified-models.json");
  let merged = {};
  try { merged = JSON.parse(await readFile(uiPath, "utf-8")); } catch {}
  merged[providerId] = Object.fromEntries(results.map(r => [r.model, { verified: r.verified, latencyMs: r.latencyMs }]));
  await writeFile(uiPath, JSON.stringify(merged, null, 2), "utf-8");
  console.log(`💾 合并落盘 ${uiPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
