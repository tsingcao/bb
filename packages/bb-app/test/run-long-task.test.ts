import { runLongTask, clearRunCheckpoints } from "../src/longrun/longrun.js";

import { describe, test, expect, afterAll } from "vitest";

describe("runLongTask", () => {
  const runId = "test-run-123";

  afterAll(async () => {
    await clearRunCheckpoints(runId);
  });

  test("should resume across invocations", async () => {
    // First invocation runs 2 steps (maxSteps=2) of a 5‑step dummy task.
    const stepFn = async (step: number, payload: any) => {
      const count = payload?.count ?? 0;
      const next = count + 1;
      if (next >= 5) {
        return { done: true, result: `Finished ${next}` };
      }
      return { done: false, payload: { count: next } };
    };

    const first = await runLongTask({ runId, maxSteps: 2, taskFn: stepFn });
    expect(first).toMatchObject({ runId, nextStep: 2, payload: { count: 2 } });

    // Second invocation resumes and runs remaining steps (maxSteps omitted => runs until done).
    const second = await runLongTask({ runId, taskFn: stepFn });
    expect(second).toBe("Finished 5");
  });
});
