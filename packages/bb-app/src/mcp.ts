import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
// BBSdk import removed (not needed for placeholder tools)

// const bb = new BBSdk(); // Deprecated placeholder, not used

// @ts-ignore
export const mcp = new McpServer({ name: "nextloop", version: "0.1.0" });

// Dynamically register .bb/skills as MCP tools
import { readdirSync } from "fs";
import { join } from "path";

const skillsDir = join(process.cwd(), ".bb", "skills");
try {
  const skillNames = readdirSync(skillsDir);
  for (const name of skillNames) {
    try {
      const skillModule = require(join(skillsDir, name, "skill.ts"));
      const tool = {
        name,
        description: skillModule.description ?? `Skill ${name}`,
        inputSchema: skillModule.inputSchema ?? z.object({}),
      } as const;
      mcp.tool(tool, async (args: any) => {
        // Pass through to the skill implementation
        return await skillModule.default(args);
      });
    } catch (e) {
      console.warn(`Failed to load skill ${name}:`, e);
    }
  }
} catch (e) {
  // No skills directory – ignore
}

// Register core NextLoop MCP tools (example placeholders)

// @ts-ignore
mcp.tool(
  {
    name: "run-harness",
    description: "Trigger NextLoop harness execution",
    inputSchema: z.object({
      spec: z.any(),
      maxIterations: z.number().int().optional(),
      timeoutMs: z.number().int().optional(),
      targetMetric: z.object({ name: z.string(), value: z.number() }).optional(),
    }),
  },
  async (args: { spec: any }) => {
    const { spec } = args;
    // Placeholder implementation for harness execution
    const resp = { status: "ok", spec };
    return { content: [{ type: "text", text: JSON.stringify(resp) }] };
  },
);

// @ts-ignore
mcp.tool(
  {
    name: "query-memory",
    description: "Query NextLoop memory / knowledge graph",
    inputSchema: z.object({ query: z.string() }),
  },
  async (args: { query: string }) => {
    const { query } = args;
    // Placeholder implementation for memory query
    const resp = { query, result: "memory data" };
    return { content: [{ type: "text", text: JSON.stringify(resp) }] };
  },
);

// @ts-ignore
mcp.tool(
  {
    name: "list-agents",
    description: "List all active NextLoop agents",
    inputSchema: z.object({}),
  },
  async (_args: {}) => {
    // Placeholder implementation for listing agents
    const resp = [{ id: "agent-1", status: "online" }];
    return { content: [{ type: "text", text: JSON.stringify(resp) }] };
  },
);

// Long‑running task tool – callers can invoke a resumable workflow.
// The `taskFn` implementation is supplied by the caller via the `spec` field.
// `spec` must contain a `stepFn` function (as a string of JavaScript) that
// will be `eval`‑ed on the server.  This is a placeholder illustrating the
// pattern; in production you would provide a safe sandbox.

// @ts-ignore
mcp.tool(
  {
    name: "run-long-task",
    description: "Execute a generic long‑running task with checkpointing",
    inputSchema: z.object({
      // Optional stable identifier for resume – if omitted a UUID is generated.
      runId: z.string().optional(),
      // Maximum number of steps to run in this invocation.
      maxSteps: z.number().int().optional(),
      // Serialized JavaScript code for the step function.  It receives
      // (step:number, payload:any) and must return { done:boolean, payload?:any, result?:any }.
      // **WARNING**: `eval` is used here only for the demo.  Replace with a sandbox.
      stepFn: z.string(),
    }),
  },
  async (args: { runId?: string; maxSteps?: number; stepFn: string }) => {
    const { runId, maxSteps, stepFn } = args;
    // Construct the step function from the provided source code.
    // In a real implementation you would run this in a safe sandbox.
    // eslint-disable-next-line no-eval
    const taskFn = eval(stepFn);
    const result = await runLongTask({ runId, maxSteps, taskFn });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

import { runLongTask } from "./longrun/longrun.js";

export async function handleMcpRequest(request: Request): Promise<Response> {
  const body = await request.json();
  // @modelcontextprotocol/server expects a JsonRpcRequest
  const result = await mcp.handle(body);
  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json" },
  });
}
