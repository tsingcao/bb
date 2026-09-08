import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { runLongTask } from "./longrun/longrun.js";

const skillsDir = join(process.cwd(), ".bb", "skills");

// Skills declare their inputSchema as plain JSON Schema (no Zod dependency).
// Convert the small subset they use into Zod so the SDK can validate calls.
function isZodSchema(value: unknown): value is z.ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  switch (schema?.type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "boolean":
      return z.boolean();
    case "array": {
      if (Array.isArray(schema.items)) {
        return z.tuple(schema.items.map((item: any) => jsonSchemaToZod(item)));
      }
      return z.array(jsonSchemaToZod(schema.items ?? { type: "string" }));
    }
    case "object": {
      const required = new Set<string>(schema.required ?? []);
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, prop] of Object.entries<any>(schema.properties ?? {})) {
        const field = jsonSchemaToZod(prop);
        const isOptional = prop?.optional === true || !required.has(key);
        shape[key] = isOptional ? field.optional() : field;
      }
      return z.object(shape);
    }
    default:
      return z.any();
  }
}

function skillInputSchema(value: unknown): z.ZodTypeAny {
  if (isZodSchema(value)) {
    return value;
  }
  try {
    return jsonSchemaToZod(value);
  } catch {
    return z.object({});
  }
}

// Loaded .bb/skills modules are cached per name so per-request server
// construction (stateless MCP mode) stays cheap. `null` marks a failed load
// so we don't retry the dynamic import on every request.
const skillCache = new Map<string, { default?: unknown; description?: string; inputSchema?: z.ZodType } | null>();

async function loadSkillModule(
  name: string,
): Promise<{ default?: unknown; description?: string; inputSchema?: z.ZodType } | null> {
  if (skillCache.has(name)) {
    return skillCache.get(name) ?? null;
  }
  try {
    const mod = await import(join(skillsDir, name, "skill.ts"));
    skillCache.set(name, mod);
    return mod;
  } catch (error) {
    console.warn(`Failed to load skill ${name}:`, error);
    skillCache.set(name, null);
    return null;
  }
}

async function registerSkills(server: McpServer): Promise<void> {
  let skillNames: string[] = [];
  try {
    skillNames = readdirSync(skillsDir);
  } catch {
    // No skills directory – ignore
  }
  for (const name of skillNames) {
    const skillModule = await loadSkillModule(name);
    if (skillModule === null || typeof skillModule.default !== "function") {
      continue;
    }
    const description = skillModule.description ?? `Skill ${name}`;
    const inputSchema = skillInputSchema(skillModule.inputSchema);
    server.registerTool(
      name,
      { title: name, description, inputSchema },
      async (args: unknown) => {
        // Call the skill implementation and wrap its result in protocol-correct
        // CallToolResult content.
        const result = await (skillModule.default as (a: unknown) => unknown)(args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      },
    );
  }
}

export async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer({ name: "nextloop", version: "0.1.0" });

  // Dynamically register .bb/skills as MCP tools.
  await registerSkills(server);

  // Core NextLoop MCP tools.
  server.registerTool(
    "run-harness",
    {
      title: "Run Harness",
      description: "Trigger NextLoop harness execution",
      inputSchema: z.object({
        spec: z.any(),
        maxIterations: z.number().int().optional(),
        timeoutMs: z.number().int().optional(),
        targetMetric: z.object({ name: z.string(), value: z.number() }).optional(),
      }),
    },
    async (args: { spec: unknown }) => {
      const { spec } = args;
      // Placeholder implementation for harness execution
      const resp = { status: "ok", spec };
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );

  server.registerTool(
    "query-memory",
    {
      title: "Query Memory",
      description: "Query NextLoop memory / knowledge graph",
      inputSchema: z.object({ query: z.string() }),
    },
    async (args: { query: string }) => {
      const { query } = args;
      // Placeholder implementation for memory query
      const resp = { query, result: "memory data" };
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );

  server.registerTool(
    "list-agents",
    {
      title: "List Agents",
      description: "List all active NextLoop agents",
      inputSchema: z.object({}),
    },
    async () => {
      // Placeholder implementation for listing agents
      const resp = [{ id: "agent-1", status: "online" }];
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );

  // Long-running task tool – callers can invoke a resumable workflow.
  // The `taskFn` implementation is supplied by the caller via the `spec` field.
  // `spec` must contain a `stepFn` function (as a string of JavaScript) that
  // will be `eval`-ed on the server.  This is a placeholder illustrating the
  // pattern; in production you would provide a safe sandbox.
  server.registerTool(
    "run-long-task",
    {
      title: "Run Long Task",
      description: "Execute a generic long-running task with checkpointing",
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
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  );

  return server;
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  // Stateless streamable-HTTP mode (matches the SDK's official Hono example):
  // a fresh transport + server per request, so no session state is kept and
  // any external client (Claude Desktop, Cursor, raw JSON-RPC) can POST.
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = await createMcpServer();
  await server.connect(transport);
  return transport.handleRequest(request);
}