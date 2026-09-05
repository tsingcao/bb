import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { getSettingsRoutePath } from "@/lib/route-paths";
import {
  dismissDshellMigrationBanner,
  shouldShowDshellMigrationBanner,
} from "@/lib/dshell-migration";

/**
 * 一次性迁移横幅：旧布尔启用值（"1"/"true"）用户首次见到新版本时，
 * 提示 DSH 皮肤已迁入 Settings（Original/Auto/Always 三态），
 * 点「Open settings」或关闭后永久不再展示。
 */
export function DshellMigrationBanner() {
  const [visible, setVisible] = useState(shouldShowDshellMigrationBanner);

  if (!visible) return null;

  const dismiss = () => {
    dismissDshellMigrationBanner();
    setVisible(false);
  };

  return (
    <div
      data-testid="dshell-migration-banner"
      role="status"
      className="flex items-center gap-2.5 border-b border-primary/20 bg-primary/[0.07] px-4 py-2 text-sm text-foreground/90"
    >
      <Icon aria-hidden name="Palette" className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 truncate">
        The DSH / NEXTLoop skin now lives in Settings with Original, Auto and Always
        modes.
      </p>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link to={getSettingsRoutePath("appearance")} onClick={dismiss}>
          Open settings
        </Link>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss DSH skin notice"
        onClick={dismiss}
      >
        <Icon aria-hidden name="X" className="size-3.5" />
      </Button>
    </div>
  );
}
