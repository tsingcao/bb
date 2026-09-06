declare module '@modelcontextprotocol/server' {
  export interface McpServerOptions {
    logger?: any;
    maxConcurrent?: number;
    name?: string;
    version?: string;
  }

  export class McpServer {
    constructor(opts: McpServerOptions);
    tool(nameOrDesc: string | { name: string; description?: string; inputSchema?: any }, handler: (params: any) => Promise<any>): void;
    handle(request: any): Promise<any>;
  }
}
