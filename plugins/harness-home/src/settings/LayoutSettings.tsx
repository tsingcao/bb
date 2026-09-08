import { useState, useEffect } from "react";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { cn } from "@bb/shared-ui/lib/utils";
import { Card } from "@bb/shared-ui/card";
import { Icon } from "@bb/shared-ui/icon";
import { useSettings } from "@bb/shared-ui/hooks/use-settings";

export function LayoutSettings() {
  // Initialize from localStorage or default to showing all cards
  const [showHero, setShowHero] = useState<boolean>(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("harness-home-layout") : null;
    return stored ? JSON.parse(stored).showHero !== false : true;
  });
  const [showSecondary, setShowSecondary] = useState<boolean>(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("harness-home-layout") : null;
    return stored ? JSON.parse(stored).showSecondary !== false : true;
  });
  const [showSidebar, setShowSidebar] = useState<boolean>(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("harness-home-layout") : null;
    return stored ? JSON.parse(stored).showSidebar !== false : true;
  });

  // Persist to localStorage when state changes
  useEffect(() => {
    localStorage.setItem("harness-home-layout", JSON.stringify({ showHero, showSecondary, showSidebar }));
  }, [showHero, showSecondary, showSidebar]);

  return (
    <Card className="p-4 space-y-4">
      <div>
        <Icon name="Home" className="size-4 me-2" />
        <span className="font-medium">任务概览卡片</span>
        <Checkbox
          checked={showHero}
          onCheckedChange={setShowHero}
          className="mt-1"
        />
      </div>

      <div>
        <Icon name="BellDot" className="size-4 me-2" />
        <span className="font-medium">Agent 健康卡片</span>
        <Checkbox
          checked={showSecondary}
          onCheckedChange={setShowSecondary}
          className="mt-1"
        />
      </div>

      <div>
        <Icon name="Download" className="size-4 me-2" />
        <span className="font-medium">成本计费卡片</span>
        <Checkbox
          checked={showSidebar}
          onCheckedChange={setShowSidebar}
          className="mt-1"
        />
      </div>
    </Card>
  );
}