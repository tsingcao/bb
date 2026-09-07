import type { CSSProperties } from "react";
import { Icon, ICON_NAMES, type IconName } from "@bb/shared-ui/icon";
import { usePluginCompactBranding } from "@/lib/plugin-logos";
import { cn } from "@bb/shared-ui/lib/utils";

// 插件声明的图标名里，未在本应用图标集内的映射到语义相近的原生图标。
// 插件生态用 lucide 风格命名（如 harness 插件的 MessagesSquare/LayoutDashboard/
// Home），应用图标集是 hugeicons——保留插件声明名可解析（不落回 Zap），
// 渲染用右侧的原生别名。
const PLUGIN_ICON_ALIASES: Record<string, IconName> = {
  MessagesSquare: "MessageSquare",
  LayoutDashboard: "GridView",
  Home: "AppWindow",
};

export function pluginIconName(icon: string | null): IconName {
  if (icon === null) return "Zap";
  if ((ICON_NAMES as readonly string[]).includes(icon)) return icon as IconName;
  return PLUGIN_ICON_ALIASES[icon] ?? "Zap";
}

export function PluginCompactIconMask({
  url,
  className,
  style,
}: {
  url: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      data-plugin-icon-asset={url}
      className={cn("inline-block size-4 shrink-0", className)}
      style={{
        ...style,
        backgroundColor: "currentColor",
        maskImage: `url("${url}")`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: `url("${url}")`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
    />
  );
}

export function PluginIcon({
  pluginId,
  icon,
  compactIconUrl: compactIconUrlProp,
  className,
}: {
  pluginId: string;
  icon: string | null;
  compactIconUrl?: string | null;
  className?: string;
}) {
  const branding = usePluginCompactBranding(pluginId);
  const compactIconUrl =
    compactIconUrlProp === undefined
      ? (branding?.compactIconUrl ?? null)
      : compactIconUrlProp;
  if (compactIconUrl !== null) {
    return <PluginCompactIconMask url={compactIconUrl} className={className} />;
  }
  return (
    <Icon
      name={pluginIconName(branding?.icon ?? icon)}
      className={cn("size-4 shrink-0", className)}
      aria-hidden="true"
    />
  );
}
