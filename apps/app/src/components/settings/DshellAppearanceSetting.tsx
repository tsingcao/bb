import { useSyncExternalStore } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@bb/shared-ui/toggle-group";
import { SettingsWithControl } from "@/components/ui/settings-section";
import {
  DSHELL_PREFERENCE_LABEL,
  getDshellMode,
  isDshellActive,
  setDshellMode,
  subscribeDshellActive,
  subscribeDshellMode,
  type DshellMode,
} from "@/lib/dshell";

export const DSHELL_SETTING_DESCRIPTION =
  "DSH-WORKTABLE style blueprint-glass chrome with a neon-cyan accent. " +
  "Light users start on Original (opt-in); new dark-mode users start on " +
  "Follow appearance automatically.";

const MODE_OPTIONS: { value: DshellMode; label: string; hint: string }[] = [
  {
    value: "off",
    label: "Original",
    hint: "bb's original look in light and dark.",
  },
  {
    value: "auto",
    label: "Follow appearance",
    hint: "DSH in dark; bb original in light.",
  },
  {
    value: "on",
    label: "DSH skin",
    hint: "DSH in light and dark.",
  },
];

// 卡片内联三档说明：与各档按钮的悬停提示同源（MODE_OPTIONS.hint），不会漂移。
const MODE_HELP_LINE = MODE_OPTIONS.map(
  (option) => `${option.label} — ${option.hint}`,
).join(" · ");

const MODE_BADGE: Record<DshellMode, string> = {
  off: "Opt-in",
  auto: "Auto",
  on: "Always",
};

function modeLabel(mode: DshellMode): string {
  return (
    MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode
  );
}

/**
 * 三态 opt-in 控件：Original / Follow appearance（跟随外观）/ DSH skin。
 * 默认 Original（off）；auto 档在暗色外观下自动启用 DSH。
 */
export function DshellAppearanceSetting() {
  const mode = useSyncExternalStore(subscribeDshellMode, getDshellMode);
  const active = useSyncExternalStore(
    subscribeDshellActive,
    isDshellActive,
  );

  const autoHint =
    mode === "auto"
      ? active
        ? "Active now — dark appearance is using the DSH skin."
        : "Inactive now — light appearance stays with bb's original look."
      : null;

  return (
    <div
      data-testid="dshell-appearance-setting"
      className={cn(
        "rounded-xl border px-4 py-3.5 transition-[border-color,box-shadow,background-color] duration-200",
        mode === "off"
          ? "border-primary/45 bg-primary/[0.07] shadow-[0_0_26px_-12px_var(--primary)]"
          : "border-primary/30 bg-primary/[0.04]",
      )}
    >
      <SettingsWithControl
        label={DSHELL_PREFERENCE_LABEL}
        labelBadge={MODE_BADGE[mode]}
        description={
          <>
            {DSHELL_SETTING_DESCRIPTION}
            {autoHint ? <span className="mt-0.5 block">{autoHint}</span> : null}
          </>
        }
      >
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value) setDshellMode(value as DshellMode);
          }}
          aria-label="DSH skin mode"
          className="gap-1"
        >
          {MODE_OPTIONS.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              size="sm"
              variant="outline"
              title={option.hint}
              aria-label={`${modeLabel(option.value)}: ${option.hint}`}
              className="whitespace-nowrap px-2"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingsWithControl>
      <p
        data-testid="dshell-mode-help"
        className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
      >
        {MODE_HELP_LINE}
      </p>
    </div>
  );
}
