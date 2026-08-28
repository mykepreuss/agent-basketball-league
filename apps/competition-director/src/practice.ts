import {
  careerPracticeObservations,
  resolveCareerPracticeDecisions,
  type SignedPlayerDecision,
} from "@abl/basketball";
import {
  CAREER_ROLE_ACTIVATION_AGGREGATE_TYPE,
  CAREER_ROLE_ACTIVATION_EVENT_TYPE,
  CAREER_ROLE_ACTIVATION_SCHEMA_DIGEST,
  roleDecisionSchemaDigest,
} from "@abl/cognition";
import {
  createCanonicalEvent,
  sha256Commitment,
  signCanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import {
  CandidateRuntimeIdentityReceiptSchema,
  RoleActivationSchema,
  SignedCanonicalCommandSchema,
} from "@abl/schemas";
import type { Address, TypedDataDomain } from "viem";
import { z } from "zod";

const ActivationResponseSchema = z.strictObject({
  activationId: z.string().min(1).max(200),
  gameId: z.string().min(1).max(200),
  kind: z.enum(["PRACTICE", "COMPETITION"]),
  role: z.enum(["PLAYER", "COACH", "REFEREE", "REPLAY"]),
  state: z.enum(["CAREER_SIGNED", "FALLBACK_SIGNED"]),
  canonical: z.literal(false),
  genesis: z.literal(false),
  participantInferenceAttempted: z.boolean(),
  participantResultAccepted: z.boolean(),
  failureStage: z
    .enum([
      "CONTEXT_MANIFEST",
      "RELAY_DELIVERY",
      "HOSTED_MODEL",
      "RESULT_VALIDATION",
      "DECISION_VALIDATION",
    ])
    .nullable()
    .default(null),
  decision: z.unknown(),
});

export interface CareerActivationInvoker {
  identity(): Promise<unknown>;
  activate(command: unknown): Promise<unknown>;
}

function deterministicUuid(subject: string): string {
  const hash = sha256Commitment(subject).slice(2);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-7${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function identityRole(
  roleClass: z.infer<typeof CandidateRuntimeIdentityReceiptSchema>["roleClass"],
) {
  return roleClass === "REPLAY_OFFICIAL" ? "REPLAY" : roleClass;
}

function materializePlayerDecision(decision: unknown): SignedPlayerDecision {
  const parsed = z
    .object({
      authorizationEvent: SignedCanonicalCommandSchema.shape.event.extend({
        aggregateVersion: z.union([z.string().regex(/^\d+$/), z.bigint()]),
      }),
    })
    .passthrough()
    .parse(decision);
  const authorizationEvent = parsed.authorizationEvent;
  return {
    ...parsed,
    authorizationEvent: {
      ...authorizationEvent,
      aggregateVersion: BigInt(authorizationEvent.aggregateVersion),
    },
  } as unknown as SignedPlayerDecision;
}

export async function dispatchCareerActivation(input: {
  activation: z.infer<typeof RoleActivationSchema>;
  coordinatorDid: string;
  coordinatorIdentity: SigningIdentity;
  domain: TypedDataDomain;
  career: CareerActivationInvoker;
}) {
  const activation = RoleActivationSchema.parse(input.activation);
  const coordinatorDid = z
    .string()
    .startsWith("did:")
    .max(500)
    .parse(input.coordinatorDid);
  const identity = CandidateRuntimeIdentityReceiptSchema.parse(
    await input.career.identity(),
  );
  if (
    identity.candidateDid !== activation.careerDid ||
    identityRole(identity.roleClass) !== activation.role
  )
    throw new Error("Career identity does not match the role activation");
  if (
    Date.parse(activation.deadlineAt) - Date.parse(activation.openedAt) !==
    20_000
  )
    throw new Error(
      "Founding Exhibition activations require a 20-second window",
    );
  const event = createCanonicalEvent({
    eventId: deterministicUuid(`${activation.activationId}:event`),
    actorDid: coordinatorDid,
    nonce: `${activation.activationId}:nonce`,
    idempotencyKey: deterministicUuid(`${activation.activationId}:idempotency`),
    aggregateType: CAREER_ROLE_ACTIVATION_AGGREGATE_TYPE,
    aggregateId: activation.activationId,
    aggregateVersion: 1n,
    eventType: CAREER_ROLE_ACTIVATION_EVENT_TYPE,
    previousEventHash: null,
    payload: activation,
    stateRoot: sha256Commitment(activation),
    schemaDigest: CAREER_ROLE_ACTIVATION_SCHEMA_DIGEST,
    timestamp: activation.openedAt,
  });
  const response = ActivationResponseSchema.parse(
    await input.career.activate({
      event: { ...event, aggregateVersion: "1" },
      signatures: [
        await signCanonicalEvent(
          input.coordinatorIdentity,
          input.domain,
          event,
        ),
      ],
    }),
  );
  if (
    response.activationId !== activation.activationId ||
    response.gameId !== activation.gameId ||
    response.kind !== activation.kind ||
    response.role !== activation.role
  )
    throw new Error("Career returned another role activation");
  const signedDecision = z
    .object({ signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/) })
    .passthrough()
    .parse(response.decision);
  if (
    signedDecision.signerAddress.toLowerCase() !==
    identity.signingAddress.toLowerCase()
  )
    throw new Error("Career activation was signed by another identity");
  return { identity, response };
}

export async function runFoundingCareerSession(input: {
  sessionId: string;
  kind?: "PRACTICE" | "COMPETITION";
  coordinatorDid: string;
  coordinatorIdentity: SigningIdentity;
  domain: TypedDataDomain;
  career: CareerActivationInvoker;
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
  let participantInferenceAttemptCount = 0;
  let participantResultCount = 0;
  for (const [index, { windowId, observation }] of observations.entries()) {
    const openedAtMs = (input.now ?? Date.now)();
    const openedAt = new Date(openedAtMs).toISOString();
    const activationId = `${sessionId}:window:${index}`;
    const activation = RoleActivationSchema.parse({
      schemaVersion: "1.0.0",
      activationId,
      gameId: sessionId,
      kind,
      careerDid: identity.candidateDid,
      role: "PLAYER",
      playerId: observation.playerId,
      teamId: observation.team,
      windowId,
      officialObservation: observation,
      observationCommitment: sha256Commitment(observation),
      stateRoot: observation.stateCommitment,
      contextPolicyCommitment: sha256Commitment({
        careerDid: identity.candidateDid,
        policy: "MINIMUM_NECESSARY_V2",
      }),
      expectedOutputSchemaDigest: roleDecisionSchemaDigest("PLAYER"),
      openedAt,
      deadlineAt: new Date(openedAtMs + 20_000).toISOString(),
    });
    const { response } = await dispatchCareerActivation({
      activation,
      coordinatorDid,
      coordinatorIdentity: input.coordinatorIdentity,
      domain: input.domain,
      career: input.career,
    });
    if (response.participantInferenceAttempted)
      participantInferenceAttemptCount += 1;
    if (response.participantResultAccepted) participantResultCount += 1;
    decisions.push(materializePlayerDecision(response.decision));
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
    participantInferenceAttemptCount,
    participantResultCount,
    fallbackCount: decisions.filter(
      ({ receipt }) => receipt.fallback !== "NONE",
    ).length,
    result,
  };
}
