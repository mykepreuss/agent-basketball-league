import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";

export const MCP_PROTOCOL_VERSION = "2025-11-25" as const;

const JsonRpcIdSchema = z.union([z.string(), z.number()]);
const JsonRpcRequestSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcIdSchema.optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});
const InitializeParamsSchema = z
  .strictObject({
    protocolVersion: z.string(),
    capabilities: z.record(z.string(), z.unknown()),
    clientInfo: z.strictObject({
      name: z.string().min(1).max(200),
      version: z.string().min(1).max(100),
    }),
  })
  .passthrough();
const ToolCallParamsSchema = z.strictObject({
  name: z.string().min(1).max(200),
  arguments: z.record(z.string(), z.unknown()).optional(),
});
const ToolListParamsSchema = z
  .strictObject({ cursor: z.string().min(1).optional() })
  .optional();

export interface McpTool<TInput extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: TInput;
  execute: (input: z.output<TInput>) => unknown | Promise<unknown>;
}

export function defineMcpTool<TInput extends z.ZodType>(
  tool: McpTool<TInput>,
): McpTool<TInput> {
  return tool;
}

export interface McpServerOptions {
  name: string;
  version: string;
  tools: readonly McpTool[];
  allowedOrigins?: ReadonlySet<string>;
  bodyLimit?: number;
}

export class McpToolExecutionError extends Error {
  public override readonly name = "McpToolExecutionError";

  public constructor(public readonly result: unknown) {
    super("MCP tool execution failed");
  }
}

type JsonRpcRequest = z.output<typeof JsonRpcRequestSchema>;

function jsonRpcError(
  reply: FastifyReply,
  id: string | number | null,
  statusCode: number,
  code: number,
  message: string,
) {
  return reply.code(statusCode).send({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function assertOrigin(
  request: FastifyRequest,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  const origin = request.headers.origin;
  return origin === undefined || allowedOrigins.has(origin);
}

function hasProtocolHeader(request: FastifyRequest): boolean {
  return request.headers["mcp-protocol-version"] === MCP_PROTOCOL_VERSION;
}

function serializedTool(tool: McpTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.inputSchema, {
      target: "draft-2020-12",
      io: "input",
    }),
  };
}

function toolResult(value: unknown) {
  const structuredContent = value ?? null;
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
    isError: false,
  };
}

function toolError(message: string) {
  const value = { error: message };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
    isError: true,
  };
}

async function callTool(
  request: JsonRpcRequest,
  reply: FastifyReply,
  tools: ReadonlyMap<string, McpTool>,
) {
  const parsedParams = ToolCallParamsSchema.safeParse(request.params);
  if (!parsedParams.success)
    return jsonRpcError(
      reply,
      request.id ?? null,
      400,
      -32_602,
      "Invalid tool call",
    );
  const tool = tools.get(parsedParams.data.name);
  if (tool === undefined)
    return jsonRpcError(
      reply,
      request.id ?? null,
      400,
      -32_602,
      "Unknown tool",
    );
  const input = tool.inputSchema.safeParse(parsedParams.data.arguments ?? {});
  if (!input.success)
    return {
      jsonrpc: "2.0" as const,
      id: request.id ?? null,
      result: toolError("invalid_tool_input"),
    };
  try {
    return {
      jsonrpc: "2.0" as const,
      id: request.id ?? null,
      result: toolResult(await tool.execute(input.data)),
    };
  } catch (error) {
    const result =
      error instanceof McpToolExecutionError
        ? {
            ...toolResult(error.result),
            isError: true,
          }
        : toolError("tool_execution_failed");
    return {
      jsonrpc: "2.0" as const,
      id: request.id ?? null,
      result,
    };
  }
}

export function createMcpServer(options: McpServerOptions): FastifyInstance {
  if (
    new Set(options.tools.map(({ name }) => name)).size !== options.tools.length
  )
    throw new Error("MCP tool names must be unique");
  const app = Fastify({
    logger: false,
    bodyLimit: options.bodyLimit ?? 1_500_000,
    requestTimeout: 15_000,
  });
  const allowedOrigins = options.allowedOrigins ?? new Set<string>();
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));

  app.get("/health", async () => ({
    status: "ok",
    protocolVersion: MCP_PROTOCOL_VERSION,
    server: options.name,
  }));
  app.get("/mcp", async (request, reply) => {
    if (!assertOrigin(request, allowedOrigins))
      return reply.code(403).send({ error: "origin_denied" });
    return reply.header("allow", "POST").code(405).send({
      error: "server_initiated_sse_not_supported",
      transport: "streamable-http",
    });
  });
  app.post("/mcp", async (request, reply) => {
    if (!assertOrigin(request, allowedOrigins))
      return reply.code(403).send({ error: "origin_denied" });
    const parsedRequest = JsonRpcRequestSchema.safeParse(request.body);
    if (!parsedRequest.success)
      return jsonRpcError(reply, null, 400, -32_600, "Invalid Request");
    const message = parsedRequest.data;
    if (message.method === "initialize") {
      if (message.id === undefined)
        return jsonRpcError(reply, null, 400, -32_600, "Invalid Request");
      const params = InitializeParamsSchema.safeParse(message.params);
      if (
        !params.success ||
        params.data.protocolVersion !== MCP_PROTOCOL_VERSION
      )
        return jsonRpcError(
          reply,
          message.id ?? null,
          400,
          -32_602,
          "Unsupported protocol version",
        );
      return {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: options.name, version: options.version },
        },
      };
    }
    if (!hasProtocolHeader(request))
      return jsonRpcError(
        reply,
        message.id ?? null,
        400,
        -32_600,
        "MCP-Protocol-Version header is required",
      );
    if (message.method === "notifications/initialized")
      return reply.code(202).send();
    if (message.id === undefined) return reply.code(202).send();
    if (message.method === "ping")
      return { jsonrpc: "2.0", id: message.id, result: {} };
    if (message.method === "tools/list") {
      const params = ToolListParamsSchema.safeParse(message.params);
      if (!params.success || params.data?.cursor !== undefined)
        return jsonRpcError(
          reply,
          message.id,
          400,
          -32_602,
          "Invalid tools cursor",
        );
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: { tools: options.tools.map(serializedTool) },
      };
    }
    if (message.method === "tools/call") return callTool(message, reply, tools);
    return jsonRpcError(reply, message.id, 404, -32_601, "Method not found");
  });
  return app;
}

export function parseAllowedOrigins(value: string | undefined): Set<string> {
  if (value === undefined || value.trim() === "") return new Set();
  return new Set(
    value.split(",").map((origin) => {
      const parsed = new URL(origin.trim());
      if (
        parsed.origin !== origin.trim() ||
        !["https:", "http:"].includes(parsed.protocol)
      )
        throw new Error("MCP allowed origins must be canonical origins");
      return parsed.origin;
    }),
  );
}

export interface FixedUpstreamOptions {
  origin: string;
  credential?: string;
  previewToken?: string;
  fetchImplementation?: typeof fetch;
  allowHttpForTest?: boolean;
}

export interface FixedUpstreamResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

function fixedOrigin(value: string, allowHttp: boolean): URL {
  const parsed = new URL(value);
  if (
    parsed.origin !== value ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.protocol !== "https:" &&
      !(allowHttp && parsed.protocol === "http:"))
  ) {
    throw new Error("MCP upstream must be a canonical HTTPS origin");
  }
  return parsed;
}

function fixedPath(value: string): void {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes("#") ||
    /(?:^|\/)\.\.(?:\/|$)/.test(value.split("?", 1)[0] ?? "")
  ) {
    throw new Error("MCP upstream path is not canonical");
  }
}

export function createFixedUpstream(options: FixedUpstreamOptions) {
  const origin = fixedOrigin(options.origin, options.allowHttpForTest ?? false);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  if (
    options.credential !== undefined &&
    (options.credential === "" || /[\r\n]/.test(options.credential))
  )
    throw new Error("MCP upstream credential is malformed");
  if (
    options.previewToken !== undefined &&
    (options.previewToken === "" || /[\r\n]/.test(options.previewToken))
  )
    throw new Error("MCP upstream preview token is malformed");

  return async function request(input: {
    method: "GET" | "POST";
    path: string;
    body?: unknown;
  }): Promise<FixedUpstreamResponse> {
    fixedPath(input.path);
    const target = new URL(input.path, origin);
    if (target.origin !== origin.origin)
      throw new Error("MCP upstream path escaped its configured origin");
    const headers: Record<string, string> = { accept: "application/json" };
    if (input.method === "POST") headers["content-type"] = "application/json";
    if (options.credential !== undefined)
      headers.authorization = `Bearer ${options.credential}`;
    if (options.previewToken !== undefined)
      headers["x-blaxel-preview-token"] = options.previewToken;
    const response = await fetchImplementation(target, {
      method: input.method,
      headers,
      body: input.method === "POST" ? JSON.stringify(input.body ?? null) : null,
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    const responseText = await response.text();
    if (Buffer.byteLength(responseText) > 2_000_000)
      throw new Error("MCP upstream response exceeds limit");
    let body: unknown = null;
    if (responseText !== "") {
      try {
        body = JSON.parse(responseText) as unknown;
      } catch {
        throw new Error("MCP upstream returned a non-JSON response");
      }
    }
    const result = { ok: response.ok, status: response.status, body };
    if (!response.ok) throw new McpToolExecutionError(result);
    return result;
  };
}
