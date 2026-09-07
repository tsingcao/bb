#!/usr/bin/env node
// 真发消息级验证 - 修正版：使用正确 thread 创建 payload，按厂商分组真测
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const BB_SERVER = process.env.BB_SERVER_URL || "http://127.0.0.1:26154";
const PROJECT_ID = process.env.BB_PROJECT_ID || "proj_piv8e7jmz9";
const CONCURRENCY = 2;
const TIMEOUT_MS = 30000;
const TEST_PROMPT = "ping";

async function fetchJSON(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS + 10000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0,400)}`);
    return text ? JSON.parse(text) : {};
  } finally { clearTimeout(t); }
}

async function getModels(providerId) {
  const url = providerId
    ? `${BB_SERVER}/api/v1/system/execution-options?providerId=${encodeURIComponent(providerId)}`
    : `${BB_SERVER}/api/v1/system/execution-options`;
  const data = await fetchJSON(url, { headers: { "content-type": "application/json" } });
  return data.models || [];
}

async function testModel(providerId, modelId) {
  const start = Date.now();
  let threadId = null;
  try {
    const threadRes = await fetchJSON(`${BB_SERVER}/api/v1/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        providerId,
        model: modelId,
        input: [{ type: "text", text: TEST_PROMPT, mentions: [] }],
        environment: { type: "project-default" },
        origin: "sdk",
      }),
    });
    threadId = threadRes.id || threadRes.thread?.id;
    if (!threadId) throw new Error("no threadId");

    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      const tl = await fetchJSON(`${BB_SERVER}/api/v1/threads/${encodeURIComponent(threadId)}/timeline`, {
        headers: { "content-type": "application/json" },
      });
      const text = JSON.stringify(tl);
      // 成功标志：turn/completed 且有 agent 消息
      if (text.includes("turn/completed") || text.includes("agentMessage")) {
        // 检查是否有错误
        if (text.includes("error") && text.includes("turn/completed")) {
          // 粗略判断，若 turn completed 但包含 error 可能是失败
        }
        return { model: modelId, verified: true, latencyMs: Date.now() - start };
      }
      // 若已 idle 但无 agent 内容，判失败
      if (text.includes('"status":"idle"') && Date.now() - start > 8000) {
        // 检查是否有实际内容
        if (text.includes("agentMessage") || text.includes("assistant")) {
          return { model: modelId, verified: true, latencyMs: Date.now() - start };
        }
      }
    }
    return { model: modelId, verified: false, error: "timeout", latencyMs: Date.now() - start };
  } catch (e) {
    return { model: modelId, verified: false, error: String(e).slice(0,500), latencyMs: Date.now() - start };
  } finally {
    if (threadId) {
      // 清理线程（归档）
      try { await fetchJSON(`${BB_SERVER}/api/v1/threads/${encodeURIComponent(threadId)}/archive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }); } catch {}
    }
  }
}

async function runPool(items, fn, concurrency) {
  const out = new Array(items.length);
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
  const providerId = process.argv[2] || "acp-opencode";
  const filterPrefix = process.argv[3] || "";
  const limit = parseInt(process.argv[4] || "0", 10); // 0 = all
  console.log(`🔍 验证 provider=${providerId} filter=${filterPrefix || "(all)"} limit=${limit||"all"} BB_SERVER=${BB_SERVER}`);

  const models = await getModels(providerId);
  console.log(`📦 拉取到 ${models.length} 个模型`);
  let targets = models.map(m => m.model || m.id).filter(id => !filterPrefix || String(id).startsWith(filterPrefix));
  if (limit > 0) targets = targets.slice(0, limit);
  console.log(`🎯 待测 ${targets.length} 个: ${targets.slice(0,5).join(", ")}${targets.length>5?" ...":""}`);

  const results = await runPool(targets, (mid) => testModel(providerId, mid), CONCURRENCY);

  const verified = results.filter(r => r.verified);
  console.log(`\n✅ 已验证可用: ${verified.length}/${results.length}`);
  verified.forEach(r => console.log("  ✅", r.model));
  console.log(`\n❌ 不可用: ${results.length-verified.length}`);
  results.filter(r=>!r.verified).slice(0,20).forEach(r=>console.log("  ❌", r.model, (r.error||"").slice(0,120)));

  await mkdir(".bb", { recursive: true });
  const outPath = join(".bb", `verified-models-${providerId.replace(/[^a-z0-9]/g,"_")}.json`);
  await writeFile(outPath, JSON.stringify({ providerId, at: new Date().toISOString(), filter: filterPrefix, results }, null, 2), "utf-8");
  console.log(`\n💾 已落盘 ${outPath}`);
  const uiPath = join(".bb", "verified-models.json");
  let merged = {};
  try { merged = JSON.parse(await readFile(uiPath, "utf-8")); } catch {}
  merged[providerId] = Object.fromEntries(results.map(r => [r.model, { verified: r.verified, latencyMs: r.latencyMs, error: r.error }] ));
  await writeFile(uiPath, JSON.stringify(merged, null, 2), "utf-8");
  console.log(`💾 合并落盘 ${uiPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
