import { useSyncExternalStore } from "react";
import { Switch } from "@bb/shared-ui/switch";
import { SettingsWithControl } from "@/components/ui/settings-section";
import {
  DSHELL_PREFERENCE_LABEL,
  isDshellEnabled,
  setDshellEnabled,
  subscribeDshellEnabled,
} from "@/lib/dshell";

export const DSHELL_SETTING_DESCRIPTION =
  "Blueprint-glass chrome with a neon-cyan accent (DSH-WORKTABLE style). " +
  "Turn off to restore bb's original appearance instantly.";

export function DshellAppearanceSetting() {
  const enabled = useSyncExternalStore(
    subscribeDshellEnabled,
    isDshellEnabled,
  );

  return (
    <SettingsWithControl
      label={DSHELL_PREFERENCE_LABEL}
      description={DSHELL_SETTING_DESCRIPTION}
    >
      <Switch
        checked={enabled}
        onCheckedChange={setDshellEnabled}
        aria-label={DSHELL_PREFERENCE_LABEL}
      />
    </SettingsWithControl>
  );
}
