import type { CSSProperties } from "react";
import { Icon, ICON_NAMES, type IconName } from "@bb/shared-ui/icon";
import { resolvePluginIconName } from "@bb/shared-ui/icon-registry";
import { usePluginCompactBranding } from "@/lib/plugin-logos";
import { cn } from "@bb/shared-ui/lib/utils";

// 插件声明的图标名里，未在本应用图标集内的经共享规范注册表
// （@bb/shared-ui/icon-registry 的 PLUGIN_ICON_ALIASES，lucide 命名 → hugeicons）
// 解析到语义相近的原生图标。新增插件图标名要么本身在 ICON_NAMES 内（自动解析）、
// 要么登记进该注册表；两者都不满足会被 PluginIcon.test 的 shipped-plugin 扫描
// 与 CI 的 check:plugin-icons 双双拒绝——本组件不维护手写别名表，解析逻辑
// 唯一实现在 icon-registry 的 resolvePluginIconName，此处只是传入原生图标集。
export function pluginIconName(icon: string | null): IconName {
  return resolvePluginIconName(icon, ICON_NAMES);
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
