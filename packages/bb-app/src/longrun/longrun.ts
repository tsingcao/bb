import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Directory for checkpoint files (relative to repository root)
const CHECKPOINT_DIR = ".bb/longrun/checkpoints";

export interface Checkpoint {
  id: string;
  step: number;
  payload: any;
  timestamp: number;
}

async function ensureDir() {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
}

export async function writeCheckpoint(cp: Checkpoint): Promise<void> {
  await ensureDir();
  const path = join(CHECKPOINT_DIR, `${cp.id}.json`);
  await writeFile(path, JSON.stringify(cp, null, 2), "utf-8");
}

export async function loadLatestCheckpoint(runId: string): Promise<Checkpoint | null> {
  try {
    const files = await (await import("node:fs/promises")).readdir(CHECKPOINT_DIR);
    const matching = files.filter(f => f.startsWith(runId)).sort().reverse();
    if (matching.length === 0) return null;
    const data = await readFile(join(CHECKPOINT_DIR, matching[0]), "utf-8");
    return JSON.parse(data) as Checkpoint;
  } catch {
    return null;
  }
}

/**
 * Run a generic long‑running task.
 * `taskFn` receives (step, payload) and returns { done: boolean, payload?: any, result?: any }.
 */
export async function runLongTask(params: {
  runId?: string;
  maxSteps?: number;
  taskFn: (step: number, payload: any) => Promise<{ done: boolean; payload?: any; result?: any }>;
}): Promise<any> {
  const runId = params.runId ?? randomUUID();
  let step = 0;
  let payload: any = null;
  const last = await loadLatestCheckpoint(runId);
  if (last) { step = last.step + 1; payload = last.payload; }
  while (params.maxSteps === undefined || step < params.maxSteps) {
    const out = await params.taskFn(step, payload);
    if (out.done) {
      await writeCheckpoint({ id: runId, step, payload: out.payload ?? null, timestamp: Date.now() });
      return out.result;
    }
    await writeCheckpoint({ id: runId, step, payload: out.payload, timestamp: Date.now() });
    payload = out.payload;
    step++;
  }
  return { runId, nextStep: step, payload };
}

export async function clearRunCheckpoints(runId: string): Promise<void> {
  try {
    const files = await (await import("node:fs/promises")).readdir(CHECKPOINT_DIR);
    for (const f of files) { if (f.startsWith(runId)) await (await import("node:fs/promises")).unlink(join(CHECKPOINT_DIR, f)); }
  } catch {}
}
