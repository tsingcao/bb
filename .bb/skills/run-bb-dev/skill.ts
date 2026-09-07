import { runLongTask } from "../../../packages/bb-app/src/longrun/longrun.js";
// Input schema defined as plain JSON (no external deps)
import { spawn } from "node:child_process";

export const description = "Run NextLoop BB app development server as a resumable long‑running task";
export const inputSchema = {
  type: "object",
  properties: {
    runId: { type: "string" }
  },
  required: []
};

// The step function launches the dev server as a child process.
// It returns `done: true` when the process exits, with the exit code as the result.
function makeStepFn() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (step: number, payload: any): Promise<{ done: boolean; result?: any }> => {
    // Only run on the first step; later steps mean the process terminated.
    if (step > 0) {
      return { done: true, result: "Process terminated before expected" };
    }
    return new Promise(resolve => {
      if (process.env.BB_FAKE_DEV === "1") {
        // In test mode return immediately.
        resolve({ done: true, result: "Fake BB dev completed" });
        return;
      }
      const proc = spawn("pnpm", ["dev"], {
        stdio: "inherit",
        shell: true,
        env: { ...process.env },
      });
      proc.on("close", code => resolve({ done: true, result: `BB dev exited with ${code}` }));
    });
  };
}

export default async function (args: { runId?: string }) {
  const { runId } = args;
  const stepFn = makeStepFn();
  const result = await runLongTask({ runId, taskFn: stepFn });
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}
