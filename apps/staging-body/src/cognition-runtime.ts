import {
  CAREER_PLAYER_ACTIVATION_AGGREGATE_TYPE,
  CAREER_PLAYER_ACTIVATION_EVENT_TYPE,
  CAREER_PLAYER_ACTIVATION_SCHEMA_DIGEST,
  CareerModelDecisionSchema,
  CareerPlayerActivationPayloadSchema,
  PLAYER_ACTION_INTENT_JSON_SCHEMA,
  careerCognitionReceipt,
  deterministicPlayerFallback,
  validateCareerPlayerIntent,
  type CareerModelDecision,
  type CareerPlayerActivationPayload,
  type SignedPlayerDecision,
} from "@abl/basketball";
import {
  createCanonicalEvent,
  recoverCanonicalEventSigner,
  sha256Commitment,
  signCanonicalEvent,
  verifyEventContent,
  type CanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import {
  CAREER_CAPABILITY_AGGREGATE_TYPE,
  CAREER_CAPABILITY_RENEWAL_EVENT_TYPE,
  CAREER_CAPABILITY_RENEWAL_SCHEMA_LABEL,
  BrokerCapabilityOperationsSchema,
  CareerCapabilityRenewalPayloadSchema,
  SchemaVersion,
  SignedCanonicalCommandSchema,
} from "@abl/schemas";
import type { TypedDataDomain } from "viem";
import { z } from "zod";

const ChatCompletionResponseSchema = z
  .object({
    model: z.string().min(1).optional(),
    choices: z
      .array(
        z.object({
          message: z.object({ content: z.string().min(1) }).passthrough(),
        }),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
      })
      .optional(),
  })
  .passthrough();
const CapabilityRenewalResponseSchema = z.strictObject({
  token: z.string().min(32).max(512),
  expiresAt: z.iso.datetime({ offset: true }),
  operations: BrokerCapabilityOperationsSchema,
});

export const CareerActivationResultSchema = z.strictObject({
  activationId: z.string().min(16).max(160),
  kind: z.enum(["PRACTICE", "COMPETITION"]),
  state: z.literal("COMPLETED"),
  canonical: z.boolean(),
  genesis: z.boolean(),
  modelAttempted: z.boolean(),
  modelDecisionAccepted: z.boolean(),
  decision: z.unknown(),
});

export interface CareerModelClient {
  decide(
    activation: CareerPlayerActivationPayload,
    timeoutMs: number,
  ): Promise<CareerModelDecision>;
}

export interface CareerCognitionIdentity extends SigningIdentity {
  candidateDid: string;
  applicationId: string;
  roleClass: "PLAYER";
}

export interface CareerActivationResult {
  activationId: string;
  kind: "PRACTICE" | "COMPETITION";
  state: "COMPLETED";
  canonical: boolean;
  genesis: boolean;
  modelAttempted: boolean;
  modelDecisionAccepted: boolean;
  decision: SignedPlayerDecision;
}

export interface VerifiedCareerPlayerActivation {
  activation: CareerPlayerActivationPayload;
  event: CanonicalEvent;
  remainingMs: number;
}

function materializeEvent(
  wire: z.infer<typeof SignedCanonicalCommandSchema>["event"],
): CanonicalEvent {
  return {
    ...wire,
    aggregateVersion: BigInt(wire.aggregateVersion),
  } as CanonicalEvent;
}

function parseModelContent(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}"))
    throw new Error("Model response is not a JSON object");
  return JSON.parse(trimmed) as unknown;
}

function deterministicUuid(subject: string): string {
  const hash = sha256Commitment(subject).slice(2);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

export class BrokerCareerModelClient implements CareerModelClient {
  readonly #origin: URL;
  #capabilityToken: string;
  readonly #previewToken: string | undefined;
  readonly #modelPath: string;
  readonly #fetch: typeof fetch;
  readonly #renewCapability: (() => Promise<string>) | undefined;

  public constructor(input: {
    origin: string;
    capabilityToken: string;
    previewToken?: string;
    modelPath: string;
    fetchImplementation?: typeof fetch;
    renewCapability?: () => Promise<string>;
  }) {
    this.#origin = new URL(input.origin);
    if (
      this.#origin.protocol !== "https:" ||
      this.#origin.pathname !== "/" ||
      this.#origin.username !== "" ||
      this.#origin.password !== ""
    )
      throw new Error("Fixed broker must be a bare HTTPS origin");
    if (
      input.capabilityToken.length < 32 ||
      /[\r\n]/.test(input.capabilityToken)
    )
      throw new Error("Fixed broker capability is malformed");
    if (
      !input.modelPath.startsWith("/") ||
      input.modelPath === "/" ||
      input.modelPath.includes("//") ||
      input.modelPath.includes("\\") ||
      input.modelPath.includes("..") ||
      input.modelPath.includes("?") ||
      input.modelPath.includes("#")
    )
      throw new Error("Model route path is not canonical");
    if (
      input.previewToken !== undefined &&
      (input.previewToken.length < 32 || /[\r\n]/.test(input.previewToken))
    )
      throw new Error("Fixed broker preview token is malformed");
    this.#capabilityToken = input.capabilityToken;
    this.#previewToken = input.previewToken;
    this.#modelPath = input.modelPath;
    this.#fetch = input.fetchImplementation ?? fetch;
    this.#renewCapability = input.renewCapability;
  }

  public async decide(
    activation: CareerPlayerActivationPayload,
    timeoutMs: number,
  ): Promise<CareerModelDecision> {
    let response = await this.#requestModel(activation, timeoutMs);
    if (response.status === 403 && this.#renewCapability !== undefined) {
      this.#capabilityToken = await this.#renewCapability();
      response = await this.#requestModel(activation, timeoutMs);
    }
    if (!response.ok)
      throw new Error(`Model broker rejected activation: ${response.status}`);
    const completion = ChatCompletionResponseSchema.parse(
      await response.json(),
    );
    const choice = completion.choices[0]!;
    const intent = validateCareerPlayerIntent(
      activation,
      parseModelContent(choice.message.content),
    );
    return CareerModelDecisionSchema.parse({
      intent,
      modelRevision: completion.model ?? activation.model.revision,
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    });
  }

  async #requestModel(
    activation: CareerPlayerActivationPayload,
    timeoutMs: number,
  ): Promise<Response> {
    return this.#fetch(new URL("/v1/proxy", this.#origin), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#capabilityToken}`,
        "content-type": "application/json",
        ...(this.#previewToken === undefined
          ? {}
          : { "x-blaxel-preview-token": this.#previewToken }),
      },
      body: JSON.stringify({
        route: "model",
        method: "POST",
        path: this.#modelPath,
        expectedVersion: "0",
        idempotencyKey: `${activation.activationId}:model`,
        body: {
          model: activation.model.name,
          messages: [
            {
              role: "system",
              content:
                "You are an autonomous ABL player. Choose exactly one legal action from the supplied partial observation. Return only the JSON action object and never claim access to hidden state.",
            },
            {
              role: "user",
              content: JSON.stringify({
                windowId: activation.windowId,
                observation: activation.observation,
                allowedOutputSchema: PLAYER_ACTION_INTENT_JSON_SCHEMA,
              }),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "abl_player_action_intent",
              strict: true,
              schema: PLAYER_ACTION_INTENT_JSON_SCHEMA,
            },
          },
          max_tokens: activation.model.maxOutputTokens,
        },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
}

export async function requestCareerCapabilityRenewal(input: {
  origin: string;
  previewToken?: string;
  identity: CareerCognitionIdentity;
  domain: TypedDataDomain;
  operations: readonly string[];
  fetchImplementation?: typeof fetch;
  now?: () => number;
}): Promise<string> {
  const now = input.now ?? Date.now;
  const issuedAtMs = now();
  const timestamp = new Date(issuedAtMs).toISOString();
  const payload = CareerCapabilityRenewalPayloadSchema.parse({
    schemaVersion: SchemaVersion,
    operations: [...input.operations].sort(),
    requestedExpiresAt: new Date(
      issuedAtMs + 4 * 60 * 60 * 1_000 - 10_000,
    ).toISOString(),
  });
  const event = createCanonicalEvent({
    eventId: randomUUID(),
    actorDid: input.identity.candidateDid,
    nonce: randomUUID(),
    idempotencyKey: randomUUID(),
    aggregateType: CAREER_CAPABILITY_AGGREGATE_TYPE,
    aggregateId: input.identity.candidateDid,
    aggregateVersion: 1n,
    eventType: CAREER_CAPABILITY_RENEWAL_EVENT_TYPE,
    previousEventHash: null,
    payload,
    stateRoot: sha256Commitment(payload),
    schemaDigest: sha256Commitment(CAREER_CAPABILITY_RENEWAL_SCHEMA_LABEL),
    timestamp,
  });
  const response = await (input.fetchImplementation ?? fetch)(
    new URL("/v1/capabilities/renew", input.origin),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.previewToken === undefined
          ? {}
          : { "x-blaxel-preview-token": input.previewToken }),
      },
      body: JSON.stringify({
        event: {
          ...event,
          aggregateVersion: event.aggregateVersion.toString(),
        },
        signatures: [
          await signCanonicalEvent(input.identity, input.domain, event),
        ],
      }),
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok)
    throw new Error(`Career capability renewal failed: ${response.status}`);
  const renewed = CapabilityRenewalResponseSchema.parse(await response.json());
  if (
    renewed.expiresAt !== payload.requestedExpiresAt ||
    JSON.stringify(renewed.operations) !== JSON.stringify(payload.operations)
  )
    throw new Error("Career capability renewal response changed its scope");
  return renewed.token;
}

export async function verifyCareerPlayerActivationCommand(input: {
  command: unknown;
  identity: CareerCognitionIdentity;
  coordinatorDid: string;
  coordinatorSignerAddress: `0x${string}`;
  domain: TypedDataDomain;
  now?: () => number;
}): Promise<VerifiedCareerPlayerActivation> {
  const now = input.now ?? Date.now;
  const command = SignedCanonicalCommandSchema.parse(input.command);
  if (command.signatures.length !== 1)
    throw new Error("Career activation requires one coordinator signature");
  const event = materializeEvent(command.event);
  verifyEventContent(event);
  const activation = CareerPlayerActivationPayloadSchema.parse(event.payload);
  const recovered = await recoverCanonicalEventSigner(
    input.domain,
    event,
    command.signatures[0]! as `0x${string}`,
  );
  if (
    recovered.toLowerCase() !== input.coordinatorSignerAddress.toLowerCase() ||
    event.actorDid !== input.coordinatorDid ||
    event.aggregateType !== CAREER_PLAYER_ACTIVATION_AGGREGATE_TYPE ||
    event.aggregateId !== activation.activationId ||
    event.eventType !== CAREER_PLAYER_ACTIVATION_EVENT_TYPE ||
    event.aggregateVersion !== 1n ||
    event.previousEventHash !== null ||
    event.schemaDigest !== CAREER_PLAYER_ACTIVATION_SCHEMA_DIGEST ||
    event.timestamp !== activation.openedAt ||
    event.stateRoot !== sha256Commitment(activation) ||
    activation.applicationId !== input.identity.applicationId ||
    activation.candidateDid !== input.identity.candidateDid ||
    activation.roleClass !== input.identity.roleClass
  )
    throw new Error("Career activation authority is invalid");

  const remainingMs = Date.parse(activation.deadlineAt) - now();
  if (remainingMs <= 0)
    throw new Error("Career activation arrived after its deadline");
  return { activation, event, remainingMs };
}

export async function executeCareerPlayerActivation(input: {
  command: unknown;
  identity: CareerCognitionIdentity;
  coordinatorDid: string;
  coordinatorSignerAddress: `0x${string}`;
  domain: TypedDataDomain;
  modelClient: CareerModelClient;
  now?: () => number;
}): Promise<CareerActivationResult> {
  const now = input.now ?? Date.now;
  const { activation, remainingMs } =
    await verifyCareerPlayerActivationCommand(input);

  let modelAttempted = false;
  let modelDecisionAccepted = false;
  let fallbackUsed = false;
  let modelRevision = activation.model.revision;
  let normalizedResourceUnits = 0;
  let intent;
  try {
    modelAttempted = true;
    const decision = await input.modelClient.decide(
      activation,
      Math.max(1, Math.min(remainingMs, 12_000)),
    );
    if (now() > Date.parse(activation.deadlineAt))
      throw new Error("Model decision missed the activation deadline");
    intent = validateCareerPlayerIntent(activation, decision.intent);
    modelRevision = decision.modelRevision;
    normalizedResourceUnits = decision.inputTokens + decision.outputTokens;
    modelDecisionAccepted = true;
  } catch {
    fallbackUsed = true;
    intent = deterministicPlayerFallback(activation);
  }
  const receipt = careerCognitionReceipt({
    activation,
    modelRevision,
    normalizedResourceUnits,
    fallbackUsed,
  });
  const decisionEvent = createCanonicalEvent({
    eventId: deterministicUuid(`${activation.activationId}:decision:event`),
    actorDid: input.identity.candidateDid,
    nonce: `${activation.activationId}:nonce`,
    idempotencyKey: deterministicUuid(
      `${activation.activationId}:decision:idempotency`,
    ),
    aggregateType: "player-decision",
    aggregateId: activation.observation.playerId,
    aggregateVersion: BigInt(activation.observation.window + 1),
    eventType: "ActionIntentSubmitted",
    previousEventHash: null,
    payload: { intent, receiptCommitment: sha256Commitment(receipt) },
    stateRoot: activation.observation.stateCommitment,
    schemaDigest: sha256Commitment("ActionIntentSubmitted:1.0.0"),
    timestamp: new Date(now()).toISOString(),
  });
  const decision: SignedPlayerDecision = {
    intent,
    receipt,
    authorizationEvent: decisionEvent,
    eventHash: decisionEvent.eventHash,
    signature: await signCanonicalEvent(
      input.identity,
      input.domain,
      decisionEvent,
    ),
    signerAddress: input.identity.address,
  };
  return CareerActivationResultSchema.parse({
    activationId: activation.activationId,
    kind: activation.kind,
    state: "COMPLETED",
    canonical: false,
    genesis: false,
    modelAttempted,
    modelDecisionAccepted,
    decision,
  }) as CareerActivationResult;
}
import { randomUUID } from "node:crypto";
