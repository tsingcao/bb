import { useState } from "react";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Card } from "@bb/shared-ui/card";
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import { LayoutSettings } from "./settings/LayoutSettings";

export default definePluginApp((app) => {
  app.slots.homepageSection({
    id: "harness-hero",
    title: "任务概览",
    component: HomepageHero,
  });

  app.slots.homepageSection({
    id: "harness-secondary",
    title: "Agent 健康",
    component: HomepageSecondary,
  });

  app.slots.homepageSection({
    id: "harness-sidebar",
    title: "成本计费",
    component: HomepageSidebar,
  });

  app.slots.settingsSection({
    id: "harness-home-layout",
    title: "首页布局",
    description: "自定义首页展示的卡片",
    component: LayoutSettings,
  });
});

function HomepageHero() {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Icon name="Check" className="size-5 text-primary" />
        <div className="flex-1">
          <div className="text-sm text-muted-foreground">进行中的任务</div>
          <div className="text-lg font-medium">0 进行中</div>
        </div>
      </div>
    </Card>
  );
}

function HomepageSecondary() {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Icon name="BellDot" className="size-5 text-warning" />
        <div className="flex-1">
          <div className="text-sm text-muted-foreground">活跃 Agent</div>
          <div className="text-lg font-medium">2 在线</div>
        </div>
      </div>
    </Card>
  );
}

function HomepageSidebar() {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Icon name="Download" className="size-5 text-success" />
        <div className="flex-1">
          <div className="text-sm text-muted-foreground">本月花费</div>
          <div className="text-lg font-medium">¥ 45.20</div>
        </div>
      </div>
    </Card>
  );
}