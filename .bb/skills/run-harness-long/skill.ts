import { runLongTask } from "../../../packages/bb-app/src/longrun/longrun.js";

export const description = "Run a long‑running harness (simulated training loop)";
export const inputSchema = {
  type: "object",
  properties: {
    targetEpoch: { type: "number" },
    maxStepsPerInvocation: { type: "number", optional: true },
  },
  required: ["targetEpoch"],
};

export default async function (args: { targetEpoch: number; maxStepsPerInvocation?: number }) {
  const { targetEpoch, maxStepsPerInvocation } = args;

  // The step function will be serialized as a string and eval'ed by the MCP tool.
  // Here we construct the source code that implements the training step.
  const stepFnSource = `
    (step, payload) => {
      const epoch = payload?.epoch ?? 0;
      const nextEpoch = epoch + 1;
      if (nextEpoch >= ${targetEpoch}) {
        return { done: true, result: \`Finished after ${targetEpoch} epochs\` };
      }
      return { done: false, payload: { epoch: nextEpoch } };
    }
  `;

  // Call the generic long‑task MCP tool via the run‑long‑task method.
  // We reuse the same process by invoking the MCP endpoint directly.
  // For simplicity we bypass MCP and call runLongTask directly.
  const result = await runLongTask({
    maxSteps: maxStepsPerInvocation,
    taskFn: eval(stepFnSource),
  });

  return result;
}
