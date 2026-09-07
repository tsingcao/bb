import { afterAll, describe, expect, test } from "vitest";
import runBbDev from "../../../.bb/skills/run-bb-dev/skill.js";
import { clearRunCheckpoints } from "../src/longrun/longrun.js";

describe("run-bb-dev skill", () => {
  const runId = "test-run-bb-dev";

  afterAll(async () => {
    await clearRunCheckpoints(runId);
  });

  test("should execute fake dev and return result", async () => {
    process.env.BB_FAKE_DEV = "1";
    const result = await runBbDev({ runId });
    // skill returns an object with content array containing JSON string of result
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toBe("Fake BB dev completed");
  });
});
