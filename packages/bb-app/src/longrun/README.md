# Long‑Running Task Framework

This module provides a lightweight, checkpoint‑based runner for long‑running workflows that can be paused and resumed across separate invocations. It is deliberately **framework‑agnostic** – the caller supplies a `taskFn` that implements the per‑step logic.

## API

```ts
export interface Checkpoint {
  /** Unique identifier for the run (UUID or user‑defined) */
  id: string;
  /** Zero‑based step index that was just executed */
  step: number;
  /** Arbitrary payload that is persisted between steps */
  payload: any;
  /** Milliseconds since epoch when the checkpoint was written */
  timestamp: number;
}

/**
 * Execute a task that may span many separate calls.
 *
 * @param params.runId      Optional stable identifier; if omitted a UUID is generated.
 * @param params.maxSteps    Optional limit on how many steps this call may perform.
 * @param params.taskFn      A function `(step: number, payload: any) => Promise<{ done: boolean; payload?: any; result?: any }>`.
 * @returns If the task finishes, returns `result`. Otherwise returns an object containing the next step
 *          number and the persisted payload so the caller can resume.
 */
export async function runLongTask(params: {
  runId?: string;
  maxSteps?: number;
  taskFn: (step: number, payload: any) => Promise<{ done: boolean; payload?: any; result?: any }>;
}): Promise<any>
```

### Helper utilities
- `writeCheckpoint(cp: Checkpoint)`: writes a checkpoint JSON file under `.bb/longrun/checkpoints`.
- `loadLatestCheckpoint(runId: string)`: loads the most recent checkpoint for a given run.
- `clearRunCheckpoints(runId: string)`: deletes all checkpoint files for a run (useful in tests).

## Example – Simulated Training Loop
```ts
import { runLongTask } from "./longrun/longrun.js";

const stepFnSource = `
  (step, payload) => {
    const epoch = payload?.epoch ?? 0;
    const next = epoch + 1;
    if (next >= 5) {
      return { done: true, result: "Finished after 5 epochs" };
    }
    return { done: false, payload: { epoch: next } };
  }
`;

// In a real world scenario you would sandbox this code. Here we `eval` for demo purposes.
const taskFn = eval(stepFnSource);

// First invocation – run two steps only.
await runLongTask({ runId: "demo", maxSteps: 2, taskFn });
// Subsequent call – resume automatically until completion.
const final = await runLongTask({ runId: "demo", taskFn });
console.log(final); // => "Finished after 5 epochs"
```

## MCP Integration
The `run‑long‑task` MCP tool forwards a serialized `stepFn` (as a string) to `runLongTask`. See `src/mcp.ts` for the registration.

## Security Note
`eval` is used **only for the demo**. Production code should execute user‑supplied step functions inside a secure sandbox (e.g., `vm2`, worker threads with restricted globals, or a separate microservice).

## Testing
`test/run-long-task.test.ts` shows a unit test that verifies checkpoint persistence and resume behaviour.
