import { expect, test } from "vitest";
import runBbDev from "../.bb/skills/run-bb-dev/skill.ts";

test("run-bb-dev fake mode returns fake message", async () => {
  // Enable fake dev mode
  process.env.BB_FAKE_DEV = "1";
  const result = await runBbDev({ runId: "test-run" });
  // Clean env var after test
  delete process.env.BB_FAKE_DEV;

  expect(result).toHaveProperty("content");
  const text = result.content?.[0]?.text ?? "";
  expect(text).toContain("Fake BB dev completed");
});
