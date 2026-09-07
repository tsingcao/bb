# run-harness-long
Long‑running harness simulation. Executes a training loop with checkpointing.

## Input
```json
{
  "targetEpoch": 5,
  "maxStepsPerInvocation": 2
}
```

- **targetEpoch**: number of epochs after which the task finishes.
- **maxStepsPerInvocation**: optional limit on how many epochs to run per call (default: 1).

## Output
When finished, returns `{ result: string }`. While running, returns the current epoch state.
