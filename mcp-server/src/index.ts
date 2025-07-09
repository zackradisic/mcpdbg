import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  type ExecuteLldbCommandRequest,
  type ExecuteLldbCommandResponse,
  type GetStackTraceRequest,
  type GetStackTraceResponse,
  type GetVariablesRequest,
  type GetVariablesResponse,
  type Event,
  messageSchema,
} from "./protocol.js";

class MCPDebuggerServer {
  private port: number;
  private mcpServer: McpServer;
  private ws: WebSocket | null = null;
  private responseHandlers = new Map<string, (response: any) => void>();
  private debuggerState = {
    isStopped: false,
    currentThreadId: 1,
    stopReason: "",
    connectionStatus: "disconnected" as
      | "disconnected"
      | "connecting"
      | "connected",
    connectionPort: null as number | null,
  };

  constructor(port: number) {
    this.port = port;
    this.mcpServer = new McpServer(
      {
        name: "mcp-debugger",
        version: "0.0.1",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupTools();
  }

  private async connectToExtension(port: number): Promise<void> {
    let retryCount = 0;
    const maxRetries = 5;
    this.debuggerState.connectionStatus = "connecting";
    this.debuggerState.connectionPort = port;

    const connect = async (): Promise<void> => {
      if (retryCount >= maxRetries) {
        this.debuggerState.connectionStatus = "disconnected";
        this.debuggerState.connectionPort = null;
        throw new Error(`Failed to connect after ${maxRetries} attempts`);
      }

      try {
        // Using Bun's built-in WebSocket
        this.ws = new WebSocket(`ws://127.0.0.1:${port}`);

        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            this.ws?.close();
            this.debuggerState.connectionStatus = "disconnected";
            this.debuggerState.connectionPort = null;
            reject(new Error("Connection timeout"));
          }, 5000);

          this.ws!.onopen = () => {
            clearTimeout(timeout);
            console.error(`Connected to VS Code extension on port ${port}`);
            this.debuggerState.connectionStatus = "connected";
            retryCount = 0; // Reset retry count on successful connection
            resolve();
          };

          this.ws!.onmessage = (event) => {
            try {
              console.error("Received message:", event.data);
              const message = JSON.parse(event.data.toString());
              const parsed = messageSchema.safeParse(message);

              if (parsed.success) {
                if (parsed.data.type === "response") {
                  const handler = this.responseHandlers.get(parsed.data.id);
                  if (handler) {
                    handler(parsed.data);
                    this.responseHandlers.delete(parsed.data.id);
                  }
                } else if (parsed.data.type === "event") {
                  this.handleEvent(parsed.data as Event);
                }
              }
            } catch (error) {
              console.error("Error parsing message:", error);
            }
          };

          this.ws!.onclose = () => {
            console.error("Disconnected from VS Code extension");
            this.debuggerState.connectionStatus = "disconnected";
            this.debuggerState.connectionPort = null;
            this.ws = null;
          };

          this.ws!.onerror = (error) => {
            clearTimeout(timeout);
            console.error("WebSocket error:", error);
            this.debuggerState.connectionStatus = "disconnected";
            this.debuggerState.connectionPort = null;
            this.ws = null;
            reject(error);
          };
        });
      } catch (error) {
        retryCount++;
        console.error(
          `Failed to connect (attempt ${retryCount}/${maxRetries}):`,
          error
        );

        if (retryCount < maxRetries) {
          // Wait 2 seconds before retrying
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return connect();
        }
        throw error;
      }
    };

    return connect();
  }

  private handleEvent(event: Event) {
    if (event.event === "debuggerStopped") {
      this.debuggerState.isStopped = true;
      this.debuggerState.currentThreadId = event.threadId;
      this.debuggerState.stopReason = event.reason;
      console.error(
        `Debugger stopped: ${event.reason} on thread ${event.threadId}`
      );
    } else if (event.event === "debuggerContinued") {
      this.debuggerState.isStopped = false;
      console.error(`Debugger continued on thread ${event.threadId}`);
    }
  }

  private async sendRequest<T>(request: any): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Try to reconnect if not connected
      if (this.debuggerState.connectionStatus !== "connecting") {
        console.error("Not connected to debugger, attempting to reconnect...");
        try {
          await this.connectToExtension(this.port);
          console.error("Reconnection successful");
        } catch (error) {
          throw new Error(`Not connected to VS Code extension and reconnection failed: ${error.message}`);
        }
      } else {
        throw new Error("Connection to VS Code extension is still being established");
      }
    }

    const id = Math.random().toString(36).substring(7);
    const requestWithId = { ...request, id };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.responseHandlers.delete(id);
        reject(new Error("Request timeout"));
      }, 30000);

      this.responseHandlers.set(id, (response) => {
        clearTimeout(timeout);
        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error || "Request failed"));
        }
      });

      this.ws!.send(JSON.stringify(requestWithId));
    });
  }

  private setupTools() {
    // Raw LLDB command execution
    this.mcpServer.registerTool(
      "debugger_executeLldbCommand",
      {
        title: "Execute LLDB Command",
        description: "Execute a raw LLDB command",
        inputSchema: {
          command: z.string().describe("The LLDB command to execute"),
        },
      },
      async ({ command }) => {
        try {
          const response = await this.sendRequest<ExecuteLldbCommandResponse>({
            type: "request",
            command: "executeLldbCommand",
            lldb_command: command,
          });

          return {
            content: [
              {
                type: "text",
                text: response.result || "Command executed successfully",
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${
                  error instanceof Error
                    ? error.message
                    : "Command execution failed"
                }`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // // Register reading
    // this.mcpServer.registerTool(
    //   "debugger_readRegisters",
    //   {
    //     title: "Read Registers",
    //     description: "Read CPU registers",
    //     inputSchema: {},
    //   },
    //   async () => {
    //     try {
    //       const response = await this.sendRequest<ExecuteLldbCommandResponse>({
    //         type: "request",
    //         command: "executeLldbCommand",
    //         lldb_command: "register read",
    //       });

    //       return {
    //         content: [
    //           {
    //             type: "text",
    //             text: response.result || "No register data available",
    //           },
    //         ],
    //       };
    //     } catch (error) {
    //       return {
    //         content: [
    //           {
    //             type: "text",
    //             text: `Error: ${
    //               error instanceof Error
    //                 ? error.message
    //                 : "Failed to read registers"
    //             }`,
    //           },
    //         ],
    //         isError: true,
    //       };
    //     }
    //   }
    // );

    // // Memory reading
    // this.mcpServer.registerTool(
    //   "debugger_readMemory",
    //   {
    //     title: "Read Memory",
    //     description: "Read memory at a specific address",
    //     inputSchema: {
    //       address: z.string().describe("Memory address to read from"),
    //       count: z
    //         .number()
    //         .optional()
    //         .default(64)
    //         .describe("Number of bytes to read (default: 64)"),
    //     },
    //   },
    //   async ({ address, count = 64 }) => {
    //     try {
    //       const response = await this.sendRequest<ExecuteLldbCommandResponse>({
    //         type: "request",
    //         command: "executeLldbCommand",
    //         lldb_command: `memory read -c ${count} ${address}`,
    //       });

    //       return {
    //         content: [
    //           {
    //             type: "text",
    //             text: response.result || "No memory data available",
    //           },
    //         ],
    //       };
    //     } catch (error) {
    //       return {
    //         content: [
    //           {
    //             type: "text",
    //             text: `Error: ${
    //               error instanceof Error
    //                 ? error.message
    //                 : "Failed to read memory"
    //             }`,
    //           },
    //         ],
    //         isError: true,
    //       };
    //     }
    //   }
    // );

    // // Stack trace
    // this.mcpServer.registerTool(
    //   "debugger_listStackFrames",
    //   {
    //     title: "List Stack Frames",
    //     description: "List the current stack frames",
    //     inputSchema: {
    //       threadId: z
    //         .number()
    //         .optional()
    //         .describe("Thread ID (uses current thread if not specified)"),
    //     },
    //   },
    //   async ({ threadId }) => {
    //     const tid = threadId || this.debuggerState.currentThreadId;

    //     try {
    //       const response = await this.sendRequest<GetStackTraceResponse>({
    //         type: "request",
    //         command: "getStackTrace",
    //         threadId: tid,
    //       });

    //       const frames = response.stackFrames || [];
    //       const text = frames
    //         .map((frame, index) => {
    //           const location = frame.source?.path
    //             ? `${frame.source.path}:${frame.line}:${frame.column}`
    //             : "Unknown location";
    //           return `#${index} ${frame.name} at ${location}`;
    //         })
    //         .join("\n");

    //       return {
    //         content: [
    //           {
    //             type: "text",
    //             text: text || "No stack frames available",
    //           },
    //         ],
    //       };
    //     } catch (error) {
    //       return {
    //         content: [
    //           {
    //             type: "text",
    //             text: `Error: ${
    //               error instanceof Error
    //                 ? error.message
    //                 : "Failed to get stack trace"
    //             }`,
    //           },
    //         ],
    //         isError: true,
    //       };
    //     }
    //   }
    // );

    // // Variables listing
    // this.mcpServer.registerTool(
    //   "debugger_listVariables",
    //   {
    //     title: "List Variables",
    //     description: "List variables in a specific scope",
    //     inputSchema: {
    //       variablesReference: z
    //         .number()
    //         .describe("Variables reference from a stack frame"),
    //     },
    //   },
    //   async ({ variablesReference }) => {
    //     try {
    //       const response = await this.sendRequest<GetVariablesResponse>({
    //         type: "request",
    //         command: "getVariables",
    //         variablesReference,
    //       });

    //       const variables = response.variables || [];
    //       const text = variables
    //         .map((variable) => {
    //           const type = variable.type ? ` (${variable.type})` : "";
    //           return `${variable.name}${type} = ${variable.value}`;
    //         })
    //         .join("\n");

    //       return {
    //         content: [
    //           {
    //             type: "text",
    //             text: text || "No variables available",
    //           },
    //         ],
    //       };
    //     } catch (error) {
    //       return {
    //         content: [
    //           {
    //             type: "text",
    //             text: `Error: ${
    //               error instanceof Error
    //                 ? error.message
    //                 : "Failed to get variables"
    //             }`,
    //           },
    //         ],
    //         isError: true,
    //       };
    //     }
    //   }
    // );

    // // Debugger state
    // this.mcpServer.registerTool(
    //   "debugger_getState",
    //   {
    //     title: "Get Debugger State",
    //     description: "Get the current debugger state",
    //     inputSchema: {},
    //   },
    //   async () => {
    //     return {
    //       content: [
    //         {
    //           type: "text",
    //           text: JSON.stringify(this.debuggerState, null, 2),
    //         },
    //       ],
    //     };
    //   }
    // );
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    console.error("MCP Debugger Server running on stdio");
    console.error(`Connecting to debugger extension on port ${this.port}...`);

    try {
      await this.connectToExtension(this.port);
      console.error(`Successfully connected to debugger extension on port ${this.port}`);
    } catch (error) {
      console.error(`Failed to connect to debugger extension on port ${this.port}:`, error);
      console.error("The server will continue running but debugger commands will fail until a connection is established.");
    }
  }
}

if (process.env.PORT === undefined) {
  throw new Error("PORT environment variable is not set");
}
const port = parseInt(process.env.PORT, 10);
const server = new MCPDebuggerServer(port);
server.run().catch(console.error);
