import { spawn } from "node:child_process";
import { z } from "zod";

export interface AdapterInvocation {
  role: "PLAYER" | "COACH" | "REFEREE" | "REPLAY";
  activation: unknown;
  context: unknown;
}

export interface AdapterResult {
  decision: unknown;
  providerProductModel: string;
  provenanceLevel:
    | "PROVIDER_ATTESTED"
    | "RUNNER_VERIFIED"
    | "PRODUCT_SURFACE_REPORTED"
    | "LOCAL_ARTIFACT_VERIFIED"
    | "DECLARED_ONLY"
    | "UNKNOWN";
  ambientProductContext:
    | "NONE"
    | "DISCLOSED_PRODUCT_CONTEXT"
    | "UNDISCLOSED_PROVIDER_CONTEXT_POSSIBLE";
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
}

export interface InferenceAdapter {
  readonly kind: "COMMAND" | "OPENAI_COMPATIBLE" | "DETERMINISTIC_TEST";
  readonly buildDigest: `0x${string}`;
  doctor(): Promise<{ ready: boolean; detail: string }>;
  invoke(input: AdapterInvocation, signal: AbortSignal): Promise<AdapterResult>;
}

export class CommandAdapter implements InferenceAdapter {
  readonly kind = "COMMAND" as const;
  readonly buildDigest: `0x${string}`;
  readonly #command: string;
  readonly #args: string[];
  readonly #identity: string;
  readonly #inputMode: "RAW_JSON" | "MODEL_PROMPT";

  public constructor(input: {
    command: string;
    args?: string[];
    identity: string;
    buildDigest: `0x${string}`;
    inputMode?: "RAW_JSON" | "MODEL_PROMPT";
  }) {
    this.#command = input.command;
    this.#args = input.args ?? [];
    this.#identity = input.identity;
    this.#inputMode = input.inputMode ?? "RAW_JSON";
    this.buildDigest = input.buildDigest;
  }

  public async doctor(): Promise<{ ready: boolean; detail: string }> {
    return new Promise((resolve) => {
      const child = spawn(this.#command, ["--version"], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      child.once("error", () =>
        resolve({ ready: false, detail: "command unavailable" }),
      );
      child.once("exit", (code) =>
        resolve({
          ready: code === 0,
          detail: code === 0 ? "command available" : `exit ${code ?? "signal"}`,
        }),
      );
    });
  }

  public async invoke(
    input: AdapterInvocation,
    signal: AbortSignal,
  ): Promise<AdapterResult> {
    const output = await new Promise<string>((resolve, reject) => {
      const childEnvironment = Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) =>
            name !== "ABL_RUNNER_STORE_B64" && name !== "ABL_RUNNER_STORE_PATH",
        ),
      );
      const child = spawn(this.#command, this.#args, {
        stdio: ["pipe", "pipe", "pipe"],
        signal,
        env: childEnvironment,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > 65_536) child.kill("SIGKILL");
        else stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.reduce((sum, part) => sum + part.byteLength, 0) < 8_192)
          stderr.push(chunk);
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0 && outputBytes <= 65_536)
          resolve(Buffer.concat(stdout).toString("utf8"));
        else
          reject(
            new Error(
              `Command adapter failed (${code ?? "signal"}): ${Buffer.concat(stderr).toString("utf8").slice(0, 500)}`,
            ),
          );
      });
      const serialized = JSON.stringify(input);
      child.stdin.end(
        this.#inputMode === "RAW_JSON"
          ? serialized
          : [
              "You are making one ABL basketball decision for the role in this request.",
              "Use only the supplied official context. Return exactly one JSON object and no prose or Markdown.",
              "For PLAYER return an action intent; COACH an instruction; REFEREE a call; REPLAY a ruling.",
              serialized,
            ].join("\n\n"),
      );
    });
    const trimmed = output.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1];
    return {
      decision: JSON.parse(fenced ?? trimmed) as unknown,
      providerProductModel: this.#identity,
      provenanceLevel: "PRODUCT_SURFACE_REPORTED",
      ambientProductContext: "DISCLOSED_PRODUCT_CONTEXT",
      usage: null,
    };
  }
}

export type ProductCommandPath =
  | "CODEX_CLI"
  | "CLAUDE_CODE"
  | "GEMINI_CLI"
  | "QWEN_LOCAL";

export function productCommandSpec(product: ProductCommandPath): {
  command: string;
  args: string[];
  identity: string;
} {
  return {
    CODEX_CLI: {
      command: "codex",
      args: [
        "exec",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--color",
        "never",
        "-",
      ],
      identity: "openai/codex-cli/participant-selected",
    },
    CLAUDE_CODE: {
      command: "claude",
      args: ["--print", "--output-format", "text"],
      identity: "anthropic/claude-code/participant-selected",
    },
    GEMINI_CLI: {
      command: "gemini",
      args: ["--output-format", "text"],
      identity: "google/gemini-cli/participant-selected",
    },
    QWEN_LOCAL: {
      command: "qwen",
      args: [],
      identity: "local/qwen-compatible/participant-selected",
    },
  }[product];
}

export function productCommandAdapter(input: {
  product: ProductCommandPath;
  executable?: string;
  modelIdentity?: string;
  buildDigest: `0x${string}`;
}): CommandAdapter {
  const preset = productCommandSpec(input.product);
  return new CommandAdapter({
    command: input.executable ?? preset.command,
    args: preset.args,
    identity: input.modelIdentity ?? preset.identity,
    buildDigest: input.buildDigest,
    inputMode: "MODEL_PROMPT",
  });
}

const OpenAiResponseSchema = z.strictObject({
  choices: z
    .array(
      z.strictObject({
        message: z.strictObject({ content: z.string() }),
      }),
    )
    .min(1),
  usage: z
    .strictObject({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
  model: z.string().optional(),
});

export class OpenAiCompatibleAdapter implements InferenceAdapter {
  readonly kind = "OPENAI_COMPATIBLE" as const;
  readonly buildDigest: `0x${string}`;
  readonly #endpoint: URL;
  readonly #model: string;
  readonly #apiKey: string | undefined;

  public constructor(input: {
    endpoint: string;
    model: string;
    apiKey?: string;
    buildDigest: `0x${string}`;
  }) {
    this.#endpoint = new URL(input.endpoint);
    this.#model = input.model;
    this.#apiKey = input.apiKey;
    this.buildDigest = input.buildDigest;
  }

  public async doctor(): Promise<{ ready: boolean; detail: string }> {
    return {
      ready:
        this.#endpoint.protocol === "https:" ||
        this.#endpoint.hostname === "127.0.0.1",
      detail: "endpoint configured",
    };
  }

  public async invoke(
    input: AdapterInvocation,
    signal: AbortSignal,
  ): Promise<AdapterResult> {
    const response = await fetch(this.#endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.#apiKey === undefined
          ? {}
          : { authorization: `Bearer ${this.#apiKey}` }),
      },
      body: JSON.stringify({
        model: this.#model,
        temperature: 0,
        messages: [{ role: "user", content: JSON.stringify(input) }],
        response_format: { type: "json_object" },
      }),
      redirect: "error",
      signal,
    });
    if (!response.ok)
      throw new Error(`OpenAI-compatible adapter returned ${response.status}`);
    const parsed = OpenAiResponseSchema.parse(await response.json());
    return {
      decision: JSON.parse(parsed.choices[0]!.message.content) as unknown,
      providerProductModel: `openai-compatible/${parsed.model ?? this.#model}`,
      provenanceLevel: "RUNNER_VERIFIED",
      ambientProductContext: "NONE",
      usage:
        parsed.usage === undefined
          ? null
          : {
              inputTokens: parsed.usage.prompt_tokens,
              outputTokens: parsed.usage.completion_tokens,
            },
    };
  }
}

export class DeterministicTestAdapter implements InferenceAdapter {
  readonly kind = "DETERMINISTIC_TEST" as const;
  readonly buildDigest: `0x${string}`;

  public constructor(buildDigest: `0x${string}`) {
    this.buildDigest = buildDigest;
  }

  public async doctor(): Promise<{ ready: boolean; detail: string }> {
    return { ready: true, detail: "deterministic fixture ready" };
  }

  public async invoke(
    input: AdapterInvocation,
    _signal: AbortSignal,
  ): Promise<AdapterResult> {
    const decision =
      input.role === "PLAYER"
        ? { action: "HOLD" }
        : input.role === "COACH"
          ? { instruction: "RETAIN_CURRENT_TACTIC_AND_LINEUP" }
          : input.role === "REFEREE"
            ? { call: "NO_CALL" }
            : { ruling: "NO_REVIEW" };
    return {
      decision,
      providerProductModel: "fixture/deterministic/structured-policy-v2",
      provenanceLevel: "LOCAL_ARTIFACT_VERIFIED",
      ambientProductContext: "NONE",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
