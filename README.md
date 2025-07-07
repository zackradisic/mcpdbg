# MCP Debugger Bridge

A bridge between AI agents using the Model Context Protocol (MCP) and the VS Code debugger, specifically targeting CodeLLDB for C++, Rust, Zig, and other compiled languages.

## Architecture

This project consists of two main components:

1. **VS Code Extension** (`vscode-extension/`): Acts as a bridge between VS Code's debugger and the MCP server
2. **MCP Server** (`mcp-server/`): Exposes debugger functionality to AI agents via MCP

```
┌─────────────┐     MCP Protocol      ┌─────────────┐     WebSocket      ┌──────────────┐     DAP      ┌──────────┐
│  AI Agent   │◄──────────────────────►│ MCP Server  │◄──────────────────►│ VS Code Ext  │◄────────────►│ CodeLLDB │
└─────────────┘                        └─────────────┘                     └──────────────┘              └──────────┘
```

## Setup

### Prerequisites

- VS Code with CodeLLDB extension installed
- Node.js and npm
- Bun runtime

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd mcp-debugger
```

2. Install VS Code Extension dependencies:
```bash
cd vscode-extension
npm install
```

3. Install MCP Server dependencies:
```bash
cd ../mcp-server
bun install
```

### Running the Extension

1. Open the `vscode-extension` folder in VS Code
2. Press F5 to launch a new VS Code window with the extension loaded
3. The extension will start a WebSocket server on port 8080

### Running the MCP Server

```bash
cd mcp-server
bun run src/index.ts
```

## WebSocket Protocol Reference

The VS Code extension and MCP server communicate using JSON messages over WebSocket.

### Request Messages (MCP Server → Extension)

#### Execute LLDB Command
```json
{
  "type": "request",
  "command": "executeLldbCommand",
  "lldb_command": "register read",
  "id": "unique-request-id"
}
```

#### Get Stack Trace
```json
{
  "type": "request",
  "command": "getStackTrace",
  "threadId": 1,
  "id": "unique-request-id"
}
```

#### Get Variables
```json
{
  "type": "request",
  "command": "getVariables",
  "variablesReference": 1000,
  "id": "unique-request-id"
}
```

### Response Messages (Extension → MCP Server)

#### Execute LLDB Command Response
```json
{
  "type": "response",
  "command": "executeLldbCommand",
  "success": true,
  "result": "rax = 0x0000000000000001",
  "id": "unique-request-id"
}
```

#### Get Stack Trace Response
```json
{
  "type": "response",
  "command": "getStackTrace",
  "success": true,
  "stackFrames": [
    {
      "id": 0,
      "name": "main",
      "source": {
        "path": "/path/to/file.cpp"
      },
      "line": 42,
      "column": 5
    }
  ],
  "id": "unique-request-id"
}
```

#### Get Variables Response
```json
{
  "type": "response",
  "command": "getVariables",
  "success": true,
  "variables": [
    {
      "name": "x",
      "value": "42",
      "type": "int",
      "variablesReference": 0
    }
  ],
  "id": "unique-request-id"
}
```

### Event Messages (Extension → MCP Server)

#### Debugger Stopped Event
```json
{
  "type": "event",
  "event": "debuggerStopped",
  "reason": "breakpoint",
  "threadId": 1,
  "description": "Stopped at breakpoint 1.1",
  "allThreadsStopped": true
}
```

#### Debugger Continued Event
```json
{
  "type": "event",
  "event": "debuggerContinued",
  "threadId": 1,
  "allThreadsContinued": true
}
```

## MCP Tools Reference

The MCP server exposes the following tools to AI agents:

### debugger_executeLldbCommand
Execute a raw LLDB command.

**Parameters:**
- `command` (string, required): The LLDB command to execute

**Example:**
```json
{
  "command": "thread backtrace"
}
```

### debugger_readRegisters
Read CPU registers.

**Parameters:** None

### debugger_readMemory
Read memory at a specific address.

**Parameters:**
- `address` (string, required): Memory address to read from
- `count` (number, optional): Number of bytes to read (default: 64)

**Example:**
```json
{
  "address": "0x7fff5fbff8c0",
  "count": 128
}
```

### debugger_listStackFrames
List the current stack frames.

**Parameters:**
- `threadId` (number, optional): Thread ID (uses current thread if not specified)

### debugger_listVariables
List variables in a specific scope.

**Parameters:**
- `variablesReference` (number, required): Variables reference from a stack frame

### debugger_getState
Get the current debugger state.

**Parameters:** None

**Returns:**
```json
{
  "isStopped": true,
  "currentThreadId": 1,
  "stopReason": "breakpoint"
}
```

## Usage Example

1. Start a debug session in VS Code with CodeLLDB
2. Set breakpoints in your code
3. Run the MCP server
4. Connect your AI agent to the MCP server
5. Use the exposed tools to inspect program state, read memory, execute LLDB commands, etc.

## Development

### Building the VS Code Extension

```bash
cd vscode-extension
npm run compile
```

### Running Tests

Testing requires:
1. A running VS Code instance with the extension loaded
2. An active debug session with CodeLLDB
3. The MCP server running

You can test individual components using tools like `websocat`:

```bash
# Test the WebSocket connection
echo '{"type":"request", "command":"executeLldbCommand", "lldb_command":"register read", "id":"test1"}' | websocat ws://127.0.0.1:8080
```

## Troubleshooting

### Extension not connecting
- Ensure the VS Code extension is activated (check the console for "MCP Debugger Bridge is now active!")
- Verify no other process is using port 8080

### MCP server connection issues
- Check that the WebSocket server is running (extension must be active)
- Verify firewall settings allow local connections on port 8080

### Debugger commands failing
- Ensure you have an active debug session with CodeLLDB
- The debug session must be paused (hit a breakpoint or manually pause)
- Check that the session type is "lldb" in VS Code

## License

MIT