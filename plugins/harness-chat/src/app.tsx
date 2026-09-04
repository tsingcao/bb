import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginThreadPanelActionContext,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb/shared-ui/icon";
import type { harnessChatRpcContract } from "./server.js";

/**
 * Harness Chat — 前端面板（接缝 A + P2 监测）。
 *
 * 两个 tab：
 *  - 对话：驱动 NextLoop Harness 会话（sessions API，经 RPC 走宿主侧代理）。
 *  - 监控：Query/监测面板 —— 会话态 + agent-runs 摘要 + 经验信号总览，
 *    数据经 harness-control-room 的透传路由拉取；附「原生右侧面板」绑定指引
 *    （Terminal/Preview/Files/Changes 按 bb 线程项目作用域，天然监测该项目）。
 */

interface ChatMessage {
  role: string;
  content: string;
  message_id?: string;
}

interface RunEpisode {
  run_id: string;
  ts?: number;
  goal?: string;
  exit_status?: string;
  rounds?: number;
  seconds?: number;
  verified?: number;
}

interface RunsResponse {
  ok?: boolean;
  runs?: { episodes?: RunEpisode[]; summary?: { total?: number } };
}

interface SignalsSummary {
  families?: number;
  records?: number;
  verified_rules?: number;
  verdicts?: { positive?: number; negative?: number; insufficient?: number };
}

interface SignalsResponse {
  ok?: boolean;
  signals?: { summary?: SignalsSummary };
}

interface StatusResponse {
  ok?: boolean;
  pending?: number;
}

type HarnessRpc = ReturnType<typeof useRpc<typeof harnessChatRpcContract>>;

const RUNS_URL = "/api/v1/plugins/harness-control-room/http/api/harness/runs";
const SIGNALS_URL = "/api/v1/plugins/harness-control-room/http/api/harness/signals";
const STATUS_URL = "/api/v1/plugins/harness-control-room/http/api/harness/status";

const EXIT_COLORS: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-600",
  max_rounds: "bg-amber-500/10 text-amber-600",
  error: "bg-red-500/10 text-red-600",
};

function formatSeconds(seconds?: number): string {
  if (seconds === undefined) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

/** P2：监测 tab —— 会话态 + episodes + 信号 + 右侧面板绑定指引。 */
function HarnessMonitor({ sessionId }: { sessionId: string | null }) {
  const [runs, setRuns] = useState<RunEpisode[]>([]);
  const [signals, setSignals] = useState<SignalsSummary | null>(null);
  const [pending, setPending] = useState(0);
  const [harnessOk, setHarnessOk] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [runsRes, signalsRes, statusRes] = await Promise.all([
        fetch(RUNS_URL),
        fetch(SIGNALS_URL),
        fetch(STATUS_URL),
      ]);
      if (!runsRes.ok && !signalsRes.ok && !statusRes.ok) {
        setHarnessOk(false);
        return;
      }
      setHarnessOk(true);
      const runsData = (await runsRes.json()) as RunsResponse;
      setRuns(runsData.runs?.episodes?.slice(0, 8) ?? []);
      const signalsData = (await signalsRes.json()) as SignalsResponse;
      setSignals(signalsData.signals?.summary ?? null);
      const statusData = (await statusRes.json()) as StatusResponse;
      setPending(statusData.pending ?? 0);
    } catch (err) {
      setHarnessOk(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const copyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard 不可用时静默 */
    }
  }, []);

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      {/* 会话状态条 */}
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
        <span
          className={`size-2 rounded-full ${
            harnessOk === null ? "bg-muted-foreground" : harnessOk ? "bg-emerald-500" : "bg-red-500"
          }`}
        />
        <span className="font-medium">Harness</span>
        <span className="text-muted-foreground">
          {harnessOk === null
            ? "检测中…"
            : harnessOk
              ? `在线 · 待处理 ${pending}`
              : "离线（8765 未启动）"}
        </span>
        {sessionId && (
          <span className="ml-auto font-mono text-xs text-muted-foreground">{sessionId.slice(0, 12)}…</span>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-600" role="alert">
          {error}
        </div>
      )}

      {/* 最近 episodes */}
      <div>
        <div className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon name="ChartColumn" className="size-3.5" />
          最近 Agent 运行
          {runs.length > 0 && (
            <span className="ml-auto font-normal normal-case text-muted-foreground/70">
              每 10s 自动刷新
            </span>
          )}
        </div>
        {runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无 episode（agent_runs 为空或 8765 离线）</p>
        ) : (
          <ul className="space-y-1">
            {runs.map((run) => (
              <li key={run.run_id} className="flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs">
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono ${
                    EXIT_COLORS[run.exit_status ?? ""] ?? "bg-muted text-muted-foreground"
                  }`}
                >
                  {run.exit_status ?? "unknown"}
                </span>
                <span className="min-w-0 flex-1 truncate" title={run.goal}>
                  {run.goal || run.run_id}
                </span>
                <span className="shrink-0 text-muted-foreground">{formatSeconds(run.seconds)}</span>
                <span className="shrink-0 font-mono text-muted-foreground">r{run.rounds ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 经验信号总览 */}
      <div>
        <div className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon name="Zap" className="size-3.5" />
          经验信号
        </div>
        {!signals ? (
          <p className="text-xs text-muted-foreground">暂无信号报告（先在工作区生成 leaderboard/industry）</p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: "规则族", value: signals.families ?? "—" },
              { label: "记录", value: signals.records ?? "—" },
              { label: "已验证", value: signals.verified_rules ?? "—" },
              { label: "正向", value: signals.verdicts?.positive ?? "—" },
              { label: "负向", value: signals.verdicts?.negative ?? "—" },
              { label: "待定", value: signals.verdicts?.insufficient ?? "—" },
            ].map((cell) => (
              <div key={cell.label} className="rounded border px-2 py-1.5 text-center">
                <div className="text-sm font-semibold">{cell.value}</div>
                <div className="text-[10px] text-muted-foreground">{cell.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 原生右侧面板绑定指引（P2 契约） */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide">
          <Icon name="PanelRight" className="size-3.5" />
          右侧面板绑定
        </div>
        <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
          Terminal / Preview / Files / Changes 是 bb 原生面板，按线程所在项目作用域：
          在本项目目录开一个 bb 线程，右侧面板即自动监测该项目的前端、文件与 git diff。
          本面板提供 harness 运行态与经验信号的实时摘要。
        </p>
        <button
          onClick={() => void copyPath("项目工作目录（bb 线程 cwd）")}
          className="rounded border px-2 py-1 text-xs"
        >
          {copied ? "已复制 ✓" : "复制项目路径"}
        </button>
      </div>
    </div>
  );
}

export function HarnessChatPanel(_props: PluginThreadPanelProps) {
  const rpc = useRpc<typeof harnessChatRpcContract>();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "monitor">("chat");
  const endRef = useRef<HTMLDivElement | null>(null);

  const refreshHistory = useCallback(
    async (sid: string, rpcClient: HarnessRpc) => {
      try {
        const { messages: msgs } = await rpcClient.call("history", { session_id: sid });
        setMessages(msgs as ChatMessage[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  const ensureSession = useCallback(
    async (rpcClient: HarnessRpc): Promise<string> => {
      if (sessionId) return sessionId;
      const created = await rpcClient.call("createSession", { goal: "" });
      setSessionId(created.session_id);
      return created.session_id;
    },
    [sessionId],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sid = await ensureSession(rpc);
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setInput("");
      await rpc.call("sendPrompt", { session_id: sid, text });
      await new Promise((r) => setTimeout(r, 2500));
      await refreshHistory(sid, rpc);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, ensureSession, input, refreshHistory, rpc]);

  useEffect(() => {
    void (async () => {
      const saved = localStorage.getItem("nxt_harness_chat_session");
      if (saved) {
        setSessionId(saved);
        await refreshHistory(saved, rpc);
      }
    })();
  }, [refreshHistory, rpc]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <Icon name="MessageSquare" className="size-4" />
        <span className="font-medium">Harness</span>
        {/* tab 切换 */}
        <div className="ml-2 flex overflow-hidden rounded-md border text-xs">
          <button
            onClick={() => setTab("chat")}
            className={`px-2 py-1 ${tab === "chat" ? "bg-primary/15 font-medium" : "text-muted-foreground"}`}
          >
            对话
          </button>
          <button
            onClick={() => setTab("monitor")}
            className={`px-2 py-1 ${tab === "monitor" ? "bg-primary/15 font-medium" : "text-muted-foreground"}`}
          >
            监控
          </button>
        </div>
        {sessionId ? (
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {sessionId.slice(0, 8)}…
          </span>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">新会话</span>
        )}
      </div>

      {tab === "monitor" ? (
        <HarnessMonitor sessionId={sessionId} />
      ) : (
        <>
          {error && (
            <div
              className="mx-3 mt-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-600"
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                输入消息驱动 NextLoop Harness 会话。回复将在此显示。
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={m.message_id ?? i}
                className={`max-w-[85%] rounded-lg border px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "ml-auto border-primary/30 bg-primary/10"
                    : m.role === "tool"
                      ? "border-border bg-muted/50 font-mono text-xs"
                      : "border-border bg-muted/30"
                }`}
              >
                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {m.role}
                </div>
                <pre className="whitespace-pre-wrap break-words font-sans">{m.content || "(空)"}</pre>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div className="flex items-end gap-2 border-t p-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="向 Harness 发消息…（Enter 发送）"
              className="min-h-0 flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="rounded-md border bg-primary/10 px-3 py-2 text-sm disabled:opacity-40"
            >
              {busy ? "发送中…" : "发送"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "harness-chat",
    title: "Harness 会话",
    icon: "MessagesSquare",
    component: HarnessChatPanel,
    layout: "flush",
    async run(context: PluginThreadPanelActionContext) {
      await context.openPanel({});
    },
  });
});
