import {
  CAREER_PLAYER_ACTIVATION_AGGREGATE_TYPE,
  CAREER_PLAYER_ACTIVATION_EVENT_TYPE,
  CAREER_PLAYER_ACTIVATION_SCHEMA_DIGEST,
  CareerPlayerActivationPayloadSchema,
  careerPracticeObservations,
  resolveCareerPracticeDecisions,
  type SignedPlayerDecision,
} from "@abl/basketball";
import {
  createCanonicalEvent,
  sha256Commitment,
  signCanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import {
  CandidateRuntimeIdentityReceiptSchema,
  SchemaVersion,
} from "@abl/schemas";
import type { TypedDataDomain } from "viem";
import type { Address } from "viem";
import { z } from "zod";

const ActivationResponseSchema = z.strictObject({
  activationId: z.string().min(16).max(160),
  kind: z.enum(["PRACTICE", "COMPETITION"]),
  state: z.literal("COMPLETED"),
  canonical: z.literal(false),
  genesis: z.literal(false),
  modelAttempted: z.boolean(),
  modelDecisionAccepted: z.boolean(),
  decision: z.unknown(),
});

export interface CareerActivationInvoker {
  identity(): Promise<unknown>;
  activate(command: unknown): Promise<unknown>;
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

export async function runFoundingCareerSession(input: {
  sessionId: string;
  kind?: "PRACTICE" | "COMPETITION";
  coordinatorDid: string;
  coordinatorIdentity: SigningIdentity;
  domain: TypedDataDomain;
  career: CareerActivationInvoker;
  model: {
    name: string;
    provider: string;
    family: string;
    revision: string;
    maxOutputTokens: number;
  };
  now?: () => number;
}) {
  const sessionId = z.string().min(16).max(120).parse(input.sessionId);
  const kind = input.kind ?? "PRACTICE";
  const coordinatorDid = z
    .string()
    .startsWith("did:")
    .max(500)
    .parse(input.coordinatorDid);
  const identity = CandidateRuntimeIdentityReceiptSchema.parse(
    await input.career.identity(),
  );
  if (identity.roleClass !== "PLAYER")
    throw new Error("Founding career session requires a player career");
  const observations = careerPracticeObservations(identity.candidateDid);
  const decisions: SignedPlayerDecision[] = [];
  let modelInvocationCount = 0;
  let modelDecisionCount = 0;
  for (const [index, { windowId, observation }] of observations.entries()) {
    const openedAtMs = (input.now ?? Date.now)();
    const openedAt = new Date(openedAtMs).toISOString();
    const activationId = `${sessionId}:window:${index}`;
    const activation = CareerPlayerActivationPayloadSchema.parse({
      schemaVersion: SchemaVersion,
      activationId,
      kind,
      applicationId: identity.applicationId,
      candidateDid: identity.candidateDid,
      roleClass: "PLAYER",
      windowId,
      observation,
      openedAt,
      deadlineAt: new Date(openedAtMs + 20_000).toISOString(),
      model: input.model,
      context: {
        manifestHash: sha256Commitment({
          applicationId: identity.applicationId,
          sessionId,
        }),
        kernelHash: sha256Commitment("abl-career-player-kernel-v1"),
        toolHash: sha256Commitment("abl-player-action-intent-v1"),
        personalMaterialSupplied: [],
      },
    });
    const event = createCanonicalEvent({
      eventId: deterministicUuid(`${activationId}:event`),
      actorDid: coordinatorDid,
      nonce: `${activationId}:nonce`,
      idempotencyKey: deterministicUuid(`${activationId}:idempotency`),
      aggregateType: CAREER_PLAYER_ACTIVATION_AGGREGATE_TYPE,
      aggregateId: activationId,
      aggregateVersion: 1n,
      eventType: CAREER_PLAYER_ACTIVATION_EVENT_TYPE,
      previousEventHash: null,
      payload: activation,
      stateRoot: sha256Commitment(activation),
      schemaDigest: CAREER_PLAYER_ACTIVATION_SCHEMA_DIGEST,
      timestamp: openedAt,
    });
    const response = ActivationResponseSchema.parse(
      await input.career.activate({
        event: {
          ...event,
          aggregateVersion: event.aggregateVersion.toString(),
        },
        signatures: [
          await signCanonicalEvent(
            input.coordinatorIdentity,
            input.domain,
            event,
          ),
        ],
      }),
    );
    if (response.activationId !== activationId)
      throw new Error("Career returned another activation");
    if (response.kind !== kind)
      throw new Error("Career returned another activation kind");
    if (response.modelAttempted) modelInvocationCount += 1;
    if (response.modelDecisionAccepted) modelDecisionCount += 1;
    decisions.push(response.decision as SignedPlayerDecision);
  }
  const result = await resolveCareerPracticeDecisions({
    kind,
    candidateDid: identity.candidateDid,
    signerAddress: identity.signingAddress as Address,
    decisions,
  });
  return {
    sessionId,
    kind,
    state: "COMPLETED" as const,
    canonical: false as const,
    genesis: false as const,
    career: {
      applicationId: identity.applicationId,
      candidateDid: identity.candidateDid,
      roleClass: identity.roleClass,
      signerAddress: identity.signingAddress,
      generatedInIsolatedRuntime: identity.generatedInIsolatedRuntime,
    },
    activationCount: decisions.length,
    modelInvocationCount,
    modelDecisionCount,
    fallbackCount: decisions.filter(({ receipt }) => receipt.fallbackUsed)
      .length,
    result,
  };
}
