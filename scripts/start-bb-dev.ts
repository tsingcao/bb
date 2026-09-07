import runBbDev from "../.bb/skills/run-bb-dev/skill.ts";

// 启动 BB app 开发任务（不使用假环境）
await runBbDev({ runId: "dev-session" });
