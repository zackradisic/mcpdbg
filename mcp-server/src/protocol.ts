import { z } from "zod";

// Request schemas (MCP Server -> Extension)
export const executeLldbCommandRequestSchema = z.object({
  type: z.literal("request"),
  command: z.literal("executeLldbCommand"),
  lldb_command: z.string(),
  id: z.string(), // Request ID for matching responses
  frameId: z
    .number()
    .optional()
    .describe(
      "The frame ID to get the stack trace for, if not provided, the top frame will be used"
    ),
});

export const getStackTraceRequestSchema = z.object({
  type: z.literal("request"),
  command: z.literal("getStackTrace"),
  threadId: z.number(),
  id: z.string(),
});

export const getVariablesRequestSchema = z.object({
  type: z.literal("request"),
  command: z.literal("getVariables"),
  variablesReference: z.number(),
  id: z.string(),
});

// Response schemas (Extension -> MCP Server)
export const executeLldbCommandResponseSchema = z.object({
  type: z.literal("response"),
  command: z.literal("executeLldbCommand"),
  success: z.boolean(),
  result: z.string().optional(),
  error: z.string().optional(),
  id: z.string(),
});

export const getStackTraceResponseSchema = z.object({
  type: z.literal("response"),
  command: z.literal("getStackTrace"),
  success: z.boolean(),
  stackFrames: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        source: z
          .object({
            name: z.string().optional(),
            path: z.string().optional(),
          })
          .optional(),
        line: z.number(),
        column: z.number(),
      })
    )
    .optional(),
  error: z.string().optional(),
  id: z.string(),
});

export const getVariablesResponseSchema = z.object({
  type: z.literal("response"),
  command: z.literal("getVariables"),
  success: z.boolean(),
  variables: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        type: z.string().optional(),
        variablesReference: z.number(),
      })
    )
    .optional(),
  error: z.string().optional(),
  id: z.string(),
});

// Event schemas (Extension -> MCP Server)
export const debuggerStoppedEventSchema = z.object({
  type: z.literal("event"),
  event: z.literal("debuggerStopped"),
  reason: z.string(), // e.g., 'breakpoint', 'exception', 'step'
  threadId: z.number(),
  description: z.string().optional(),
  allThreadsStopped: z.boolean().optional(),
});

export const debuggerContinuedEventSchema = z.object({
  type: z.literal("event"),
  event: z.literal("debuggerContinued"),
  threadId: z.number(),
  allThreadsContinued: z.boolean().optional(),
});

// Union types for easier parsing
export const requestSchema = z.union([
  executeLldbCommandRequestSchema,
  getStackTraceRequestSchema,
  getVariablesRequestSchema,
]);

export const responseSchema = z.union([
  executeLldbCommandResponseSchema,
  getStackTraceResponseSchema,
  getVariablesResponseSchema,
]);

export const eventSchema = z.union([
  debuggerStoppedEventSchema,
  debuggerContinuedEventSchema,
]);

export const messageSchema = z.union([
  requestSchema,
  responseSchema,
  eventSchema,
]);

// Type exports
export type ExecuteLldbCommandRequest = z.infer<
  typeof executeLldbCommandRequestSchema
>;
export type GetStackTraceRequest = z.infer<typeof getStackTraceRequestSchema>;
export type GetVariablesRequest = z.infer<typeof getVariablesRequestSchema>;

export type ExecuteLldbCommandResponse = z.infer<
  typeof executeLldbCommandResponseSchema
>;
export type GetStackTraceResponse = z.infer<typeof getStackTraceResponseSchema>;
export type GetVariablesResponse = z.infer<typeof getVariablesResponseSchema>;

export type DebuggerStoppedEvent = z.infer<typeof debuggerStoppedEventSchema>;
export type DebuggerContinuedEvent = z.infer<
  typeof debuggerContinuedEventSchema
>;

export type Request = z.infer<typeof requestSchema>;
export type Response = z.infer<typeof responseSchema>;
export type Event = z.infer<typeof eventSchema>;
export type Message = z.infer<typeof messageSchema>;
