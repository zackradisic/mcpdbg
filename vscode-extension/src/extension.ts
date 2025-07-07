import * as vscode from "vscode";
import { WebSocketServer, WebSocket } from "ws";
import {
  messageSchema,
  Request,
  Response,
  Event,
  ExecuteLldbCommandRequest,
  ExecuteLldbCommandResponse,
  GetStackTraceRequest,
  GetStackTraceResponse,
  GetVariablesRequest,
  GetVariablesResponse,
  DebuggerStoppedEvent,
  DebuggerContinuedEvent,
} from "./protocol";

let wss: WebSocketServer | undefined;
let clients: Set<WebSocket> = new Set();
let outputChannel: vscode.OutputChannel;
let currentPort: number | undefined;

let pausedLocation:
  | {
      threadId: number;
      frameId?: number;
    }
  | undefined = undefined;

export function activate(context: vscode.ExtensionContext) {
  // Create dedicated output channel
  outputChannel = vscode.window.createOutputChannel("MCP Debugger");
  outputChannel.appendLine("MCP Debugger Bridge is now active!");
  console.log("MCP Debugger Bridge is now active!");

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterTrackerFactory("lldb", {
      createDebugAdapterTracker(
        session: vscode.DebugSession
      ): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        return {
          onDidSendMessage(message) {
            // outputChannel.appendLine(
            //   `LLDB Debugger sent message: ${JSON.stringify(message)}`
            // );

            if (message.type === "event" && message.event === "stopped") {
              pausedLocation = {
                threadId: message.body.threadId,
              };
            }
          },
        };
      },
    })
  );

  // Start WebSocket server with random port
  startWebSocketServer();

  // Register command to copy port
  const copyPortCommand = vscode.commands.registerCommand(
    "mcp-debugger.copyPort",
    () => {
      if (currentPort) {
        vscode.env.clipboard.writeText(currentPort.toString());
        vscode.window.showInformationMessage(
          `Copied MCP Debugger port ${currentPort} to clipboard`
        );
      } else {
        vscode.window.showErrorMessage("MCP Debugger server is not running");
      }
    }
  );

  context.subscriptions.push(copyPortCommand);

  // Register debug adapter tracker for event tracking
  const debugTrackerFactory: vscode.DebugAdapterTrackerFactory = {
    createDebugAdapterTracker(
      session: vscode.DebugSession
    ): vscode.ProviderResult<vscode.DebugAdapterTracker> {
      if (session.type !== "lldb") {
        return undefined;
      }

      return {
        onDidSendMessage: (message: any) => {
          // Handle debugger events
          if (message.type === "event") {
            if (message.event === "stopped") {
              const event: DebuggerStoppedEvent = {
                type: "event",
                event: "debuggerStopped",
                reason: message.body.reason || "unknown",
                threadId: message.body.threadId,
                description: message.body.description,
                allThreadsStopped: message.body.allThreadsStopped,
              };
              broadcastEvent(event);
            } else if (message.event === "continued") {
              const event: DebuggerContinuedEvent = {
                type: "event",
                event: "debuggerContinued",
                threadId: message.body.threadId,
                allThreadsContinued: message.body.allThreadsContinued,
              };
              broadcastEvent(event);
            }
          }
        },
      };
    },
  };

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterTrackerFactory("lldb", debugTrackerFactory)
  );
}

function startWebSocketServer() {
  const maxRetries = 10;
  let retries = 0;

  const tryStart = () => {
    // Generate random port between 10000 and 60000
    const port = Math.floor(Math.random() * 50000) + 10000;

    try {
      wss = new WebSocketServer({ port });

      wss.on("listening", () => {
        currentPort = port;
        outputChannel.appendLine(`WebSocket server listening on port ${port}`);
        console.log(`WebSocket server listening on port ${port}`);
        vscode.window.showInformationMessage(
          `MCP Debugger server started on port ${port}`
        );
      });

      wss.on("connection", (ws) => {
        outputChannel.appendLine("New WebSocket client connected");
        console.log("New WebSocket client connected");
        clients.add(ws);

        ws.on("message", async (data) => {
          try {
            const message = JSON.parse(data.toString());
            const parsed = messageSchema.safeParse(message);

            if (!parsed.success) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  error: "Invalid message format",
                  details: parsed.error.format(),
                })
              );
              return;
            }

            // Handle requests
            if (parsed.data.type === "request") {
              await handleRequest(ws, parsed.data as Request);
            }
          } catch (error) {
            outputChannel.appendLine(`Error handling message: ${error}`);
            console.error("Error handling message:", error);
            ws.send(
              JSON.stringify({
                type: "error",
                error: "Failed to process message",
                details:
                  error instanceof Error ? error.message : "Unknown error",
              })
            );
          }
        });

        ws.on("close", () => {
          outputChannel.appendLine("WebSocket client disconnected");
          console.log("WebSocket client disconnected");
          clients.delete(ws);
        });

        ws.on("error", (error) => {
          outputChannel.appendLine(`WebSocket error: ${error}`);
          console.error("WebSocket error:", error);
          clients.delete(ws);
        });
      });

      wss.on("error", (error: Error) => {
        if (error.message.includes("EADDRINUSE")) {
          outputChannel.appendLine(
            `Port ${port} is in use, trying another port...`
          );
          retries++;
          if (retries < maxRetries) {
            wss = undefined;
            setTimeout(tryStart, 100);
          } else {
            outputChannel.appendLine(
              `Failed to start WebSocket server after ${maxRetries} attempts`
            );
            vscode.window.showErrorMessage(
              "Failed to start MCP Debugger server: All ports are in use"
            );
          }
        } else {
          outputChannel.appendLine(`WebSocket server error: ${error}`);
          console.error("WebSocket server error:", error);
        }
      });
    } catch (error) {
      outputChannel.appendLine(`Failed to create WebSocket server: ${error}`);
      console.error("Failed to create WebSocket server:", error);
    }
  };

  tryStart();
}

async function handleRequest(ws: WebSocket, request: Request) {
  switch (request.command) {
    case "executeLldbCommand":
      await handleExecuteLldbCommand(ws, request as ExecuteLldbCommandRequest);
      break;
    case "getStackTrace":
      await handleGetStackTrace(ws, request as GetStackTraceRequest);
      break;
    case "getVariables":
      await handleGetVariables(ws, request as GetVariablesRequest);
      break;
  }
}

async function handleExecuteLldbCommand(
  ws: WebSocket,
  request: ExecuteLldbCommandRequest
) {
  const session = vscode.debug.activeDebugSession;
  outputChannel.appendLine(`Executing LLDB command: "${request.lldb_command}"`);

  if (!session || session.type !== "lldb") {
    const response: ExecuteLldbCommandResponse = {
      type: "response",
      command: "executeLldbCommand",
      success: false,
      error: "No active LLDB debug session",
      id: request.id,
    };
    ws.send(JSON.stringify(response));
    return;
  }

  try {
    outputChannel.appendLine(
      `Executing LLDB command: "${request.lldb_command}"`
    );

    // Check if we need to use a different context for certain commands
    const result = (await session.customRequest("evaluate", {
      expression: request.lldb_command,
      context: "_command",
    })) as { result: string };

    outputChannel.appendLine(`LLDB command result: ${JSON.stringify(result)}`);

    const response: ExecuteLldbCommandResponse = {
      type: "response",
      command: "executeLldbCommand",
      success: true,
      result: result.result,
      id: request.id,
    };
    ws.send(JSON.stringify(response));
  } catch (error) {
    outputChannel.appendLine(
      `Error executing LLDB command "${request.lldb_command}": ${error}`
    );
    console.error("Error executing LLDB command:", error);
    const response: ExecuteLldbCommandResponse = {
      type: "response",
      command: "executeLldbCommand",
      success: false,
      error:
        error instanceof Error ? error.message : "Command execution failed",
      id: request.id,
    };
    ws.send(JSON.stringify(response));
  }
}

async function handleGetStackTrace(
  ws: WebSocket,
  request: GetStackTraceRequest
) {
  const session = vscode.debug.activeDebugSession;

  if (!session || session.type !== "lldb") {
    const response: GetStackTraceResponse = {
      type: "response",
      command: "getStackTrace",
      success: false,
      error: "No active LLDB debug session",
      id: request.id,
    };
    ws.send(JSON.stringify(response));
    return;
  }

  try {
    const result = await session.customRequest("stackTrace", {
      threadId: request.threadId,
      startFrame: 0,
      levels: 100,
    });

    const response: GetStackTraceResponse = {
      type: "response",
      command: "getStackTrace",
      success: true,
      stackFrames: result.body.stackFrames,
      id: request.id,
    };
    ws.send(JSON.stringify(response));
  } catch (error) {
    const response: GetStackTraceResponse = {
      type: "response",
      command: "getStackTrace",
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get stack trace",
      id: request.id,
    };
    ws.send(JSON.stringify(response));
  }
}

async function handleGetVariables(ws: WebSocket, request: GetVariablesRequest) {
  const session = vscode.debug.activeDebugSession;

  if (!session || session.type !== "lldb") {
    const response: GetVariablesResponse = {
      type: "response",
      command: "getVariables",
      success: false,
      error: "No active LLDB debug session",
      id: request.id,
    };
    ws.send(JSON.stringify(response));
    return;
  }

  try {
    // If variablesReference is 0, we need to get scopes first
    let variablesRef = request.variablesReference;

    if (variablesRef === 0) {
      // This is a request for top-level scopes, but we need a frame ID
      // For now, we'll return an error suggesting to use a specific reference
      const response: GetVariablesResponse = {
        type: "response",
        command: "getVariables",
        success: false,
        error: "Please provide a valid variablesReference from a stack frame",
        id: request.id,
      };
      ws.send(JSON.stringify(response));
      return;
    }

    const result = await session.customRequest("variables", {
      variablesReference: variablesRef,
    });

    const response: GetVariablesResponse = {
      type: "response",
      command: "getVariables",
      success: true,
      variables: result.body.variables,
      id: request.id,
    };
    ws.send(JSON.stringify(response));
  } catch (error) {
    const response: GetVariablesResponse = {
      type: "response",
      command: "getVariables",
      success: false,
      error: error instanceof Error ? error.message : "Failed to get variables",
      id: request.id,
    };
    ws.send(JSON.stringify(response));
  }
}

function broadcastEvent(event: Event) {
  const message = JSON.stringify(event);
  clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

export function deactivate() {
  if (outputChannel) {
    outputChannel.dispose();
  }
  if (wss) {
    clients.forEach((client) => client.close());
    wss.close();
  }
}

// This function assumes the debugger is already stopped.
// async function getTopFrameId(): Promise<number | undefined> {
//   const session = vscode.debug.activeDebugSession;
//   if (!session || session.type !== "lldb") {
//     vscode.window.showErrorMessage("No active CodeLLDB debug session.");
//     return;
//   }

//   try {
//     /*
//     const threadsResponse = await session.customRequest("threads");
//     if (!threadsResponse || threadsResponse.threads.length === 0) {
//       vscode.window.showErrorMessage("No threads found in the debuggee.");
//       return;
//     }

//     // Let's use the first thread for this example. A real implementation might
//     // need to be more sophisticated if multiple threads are stopped.
//     const threadId = threadsResponse.threads[0].id;
//     outputChannel.appendLine(
//       `THREAD RESPONSE: ${JSON.stringify(threadsResponse)}`
//     );

//     // 2. Get the stack trace for that thread.
//     const stackTraceResponse = await session.customRequest("stackTrace", {
//       threadId: threadId,
//       levels: 1,
//     });
//     if (!stackTraceResponse || stackTraceResponse.stackFrames.length === 0) {
//       vscode.window.showErrorMessage("Could not retrieve a stack trace.");
//       return;
//     }

//     // 3. Extract the frameId of the top frame.
//     const frameId = stackTraceResponse.stackFrames[0].id;
//     */
//     const frameId = (await session.customRequest("selectedFrame")) as {
//       frame: number | undefined;
//     };
//     outputChannel.appendLine(`USING frameId: ${JSON.stringify(frameId)}`);

//     return frameId.frame;
//   } catch (error) {
//     outputChannel.appendLine(
//       `Error getting top frameId: ${
//         error instanceof Error ? error.message : "Unknown error"
//       }`
//     );
//     vscode.window.showErrorMessage(
//       `Error getting top frameId: ${
//         error instanceof Error ? error.message : "Unknown error"
//       }`
//     );
//   }
// }
