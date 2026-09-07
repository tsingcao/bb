# run-bb-dev
Runs the NextLoop BB app in development mode (watch / hot‑reload) as a long‑running task.

## Input
```json
{
  "runId": "optional‑string"
}
```
- **runId**: optional stable identifier for the task. If omitted a UUID will be generated.

## Output
Returns the result of the dev server when it terminates (e.g., exit code). While running, the task remains pending and can be resumed via the same `runId` if interrupted.
