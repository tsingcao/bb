import runBbDev from "../.bb/skills/run-bb-dev/skill.ts";
process.env.BB_FAKE_DEV = '1';
await runBbDev({ runId: "dev-fake" });
