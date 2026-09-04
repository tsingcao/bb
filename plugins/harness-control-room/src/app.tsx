import { useCallback, useEffect, useState } from "react";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb/shared-ui/icon";

/**
 * Harness Control Room — 前端组件。
 *
 * 形态（借 DSH-WORKTABLE 的应用抽屉）：侧边栏一个 navPanel 入口，
 * 打开后 iframe 内嵌 8765 Control Room；侧栏徽章显示 needs-you 计数。
 *
 * 数据流：iframe 直连 8765（CORS 已在主仓放行 18154 源）；
 * 徽章走插件自己的 HTTP route `/api/v1/plugins/harness-control-room/http/api/harness/status`
 * （宿主侧代理，避免 CORS/token 问题）。
 */

const HARNESS_IFRAME_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_HARNESS_URL ??
  "http://127.0.0.1:8765/";

const STATUS_URL =
  "/api/v1/plugins/harness-control-room/http/api/harness/status";

interface HarnessStatus {
  ok: boolean;
  url: string;
  pending: number;
  error?: string;
}

function ControlRoomApp(_props: PluginNavPanelProps) {
  const [pending, setPending] = useState(0);
  const [reachable, setReachable] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(STATUS_URL);
      if (!res.ok) {
        setReachable(false);
        return;
      }
      const status = (await res.json()) as HarnessStatus;
      setPending(status.pending ?? 0);
      setReachable(status.ok);
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <Icon name="AppWindow" className="size-4" />
        <span className="font-medium">NextLoop Control Room</span>
        <span
          className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
            reachable === null
              ? "bg-secondary text-muted-foreground"
              : reachable
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-red-500/10 text-red-600"
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${
              reachable === null
                ? "bg-muted-foreground"
                : reachable
                  ? "bg-emerald-500"
                  : "bg-red-500"
            }`}
          />
          {reachable === null ? "检测中…" : reachable ? `在线 · 待处理 ${pending}` : "离线"}
        </span>
      </div>
      <iframe
        src={HARNESS_IFRAME_URL}
        title="NextLoop Control Room"
        className="min-h-0 w-full flex-1 border-0 bg-background"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "harness-control-room",
    title: "Control Room",
    icon: "AppWindow",
    path: "control-room",
    component: ControlRoomApp,
  });
});
