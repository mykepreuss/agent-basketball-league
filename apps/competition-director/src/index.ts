import { SandboxInstance } from "@blaxel/core";
import {
  CAREER_POSSESSION_PROPOSAL_AGGREGATE_TYPE,
  CAREER_POSSESSION_PROPOSAL_EVENT_TYPE,
  CAREER_POSSESSION_PROPOSAL_SCHEMA_DIGEST,
  recoverCompetitionAssertionSigner,
  signCompetitionAssertion,
} from "@abl/cognition";
import {
  CAREER_GAME_FINALIZATION_PROPOSAL_AGGREGATE_TYPE,
  CAREER_GAME_FINALIZATION_PROPOSAL_EVENT_TYPE,
  CAREER_GAME_FINALIZATION_PROPOSAL_SCHEMA_DIGEST,
} from "@abl/basketball";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
} from "@abl/recognition";
import {
  CareerPositionProfileAttestationSchema,
  CandidateRuntimeIdentityReceiptSchema,
  GameScheduleNoticeSchema,
  ParticipationResponseSchema,
  ReadinessLeaseSchema,
  RoleActivationSchema,
  RunnerDelegationSchema,
} from "@abl/schemas";
import Fastify, { type FastifyRequest } from "fastify";
import type { Hex } from "viem";
import { z } from "zod";

import { CompetitionConductor } from "./conductor.js";
import {
  CompetitionParticipantSchema,
  LineupSubmissionSchema,
  PositionedSubstitutionSubmissionSchema,
  applyCoachSubstitution,
  beginGame,
  completeScheduledGame,
  createScheduledGame,
  lockLineup,
  recordActivationAvailability,
  recordActivationBatch,
  recordPossessionResolution,
  recordParticipation,
  resumeGame,
} from "./lifecycle.js";
import {
  dispatchCareerActivation,
  runFoundingCareerSession,
} from "./practice.js";
import { CompetitionGameStore } from "./store.js";
import {
  CompetitionScheduler,
  recordVerifiedReadinessLease,
  type ReadinessCollection,
} from "./scheduler.js";
import { FoundingLiveGameExecutor } from "./live-game.js";
import {
  NEUTRAL_OFFICIAL_REGISTRY,
  assertNeutralOfficialSchedule,
} from "./neutral-official-registry.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

function deterministicUuid(subject: string): string {
  const hash = sha256Commitment(subject).slice(2);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-7${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const DomainSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  chainId: z.number().int().positive(),
  verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});
const CareerResourceNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const CreateGameSchema = z.strictObject({
  gameId: z.string().min(1).max(200),
  scheduledTipoffAt: z.iso.datetime({ offset: true }),
  participants: z.array(CompetitionParticipantSchema).length(26),
  careerResources: z.record(
    z.string().startsWith("did:"),
    CareerResourceNameSchema,
  ),
  createdAt: z.iso.datetime({ offset: true }),
});
const AvailabilitySchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  activationId: z.string().min(1).max(200),
  careerDid: z.string().startsWith("did:"),
  completed: z.boolean(),
  activationCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
  recordedAt: z.iso.datetime({ offset: true }),
});
const PracticeSchema = z.strictObject({
  sessionId: z.string().min(16).max(120),
  kind: z.enum(["PRACTICE", "COMPETITION"]),
  careerSandboxName: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
});
const ActivationBatchSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  activations: z
    .array(
      z.strictObject({
        careerSandboxName: z
          .string()
          .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
        activation: RoleActivationSchema,
      }),
    )
    .min(1)
    .max(16),
});
const RunnerDelegationRouteSchema = z.strictObject({
  careerDid: z.string().startsWith("did:"),
  submission: z.strictObject({
    offerId: z.uuid(),
    pairingToken: z.string().min(32).max(512),
    runnerId: z.string().min(1).max(160),
    delegateSigningAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    delegateEncryptionPublicKey: z.string().regex(/^0x[0-9a-f]{64}$/),
  }),
});
const RunnerDelegationRenewalRouteSchema = z.strictObject({
  delegation: RunnerDelegationSchema,
});

const internalToken = required("ABL_COMPETITION_INTERNAL_TOKEN");
const careerPairingToken = required("ABL_CAREER_PAIRING_INTERNAL_TOKEN");
const schedulingEnabled =
  process.env.ABL_COMPETITION_SCHEDULING_ENABLED === "true";
const coordinatorDid = required("ABL_COMPETITION_COORDINATOR_DID");
const coordinatorIdentity = createSigningIdentity(
  z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .parse(required("ABL_COMPETITION_COORDINATOR_SIGNING_KEY")) as Hex,
);
const parsedDomain = DomainSchema.parse(
  JSON.parse(required("ABL_COMPETITION_COMMAND_DOMAIN_JSON")),
);
const domain = {
  ...parsedDomain,
  verifyingContract: parsedDomain.verifyingContract as Hex,
};
const store = new CompetitionGameStore({
  databaseUrl: required("DATABASE_URL"),
  leaseOwner: required("ABL_COMPETITION_DIRECTOR_INSTANCE_ID"),
});

function authorized(request: FastifyRequest): boolean {
  return request.headers.authorization === `Bearer ${internalToken}`;
}

async function careerInvoker(resourceName: string) {
  const sandbox = await SandboxInstance.get(resourceName);
  return {
    async identity() {
      const response = await sandbox.fetch(3_000, "/v1/career/identity");
      if (!response.ok) throw new Error("Career identity request failed");
      return response.json();
    },
    async activate(command: unknown) {
      const response = await sandbox.fetch(3_000, "/v1/career/activations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(22_000),
      });
      if (!response.ok) throw new Error("Career activation failed");
      return response.json();
    },
  };
}

async function collectCareerReadiness(input: {
  gameId: string;
  careerDid: string;
  careerResourceName: string;
}): Promise<ReadinessCollection> {
  try {
    const sandbox = await SandboxInstance.get(input.careerResourceName);
    const response = await sandbox.fetch(3_000, "/v1/career/readiness-leases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId: input.gameId }),
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok)
      return {
        lease: ReadinessLeaseSchema.parse(await response.json()),
        failure: null,
      };
    return {
      lease: null,
      failure:
        response.status === 409
          ? "PARTICIPANT_UNAVAILABLE"
          : "ABL_SERVICE_FAILURE",
      evidenceCommitment: sha256Commitment({
        gameId: input.gameId,
        careerDid: input.careerDid,
        careerResourceName: input.careerResourceName,
        responseStatus: response.status,
      }),
    };
  } catch {
    return {
      lease: null,
      failure: "ABL_SERVICE_FAILURE",
      evidenceCommitment: sha256Commitment({
        gameId: input.gameId,
        careerDid: input.careerDid,
        careerResourceName: input.careerResourceName,
        classification: "CAREER_READINESS_UNAVAILABLE",
      }),
    };
  }
}

const scheduler = new CompetitionScheduler({
  store,
  collectReadiness: collectCareerReadiness,
});
const possessionResponseSchema = z.strictObject({
  canonicalEventHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  finalStateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
  eventMerkleRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
  upstreamCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
  canonical: z.literal(false),
  genesis: z.literal(false),
});
const liveGameExecutor = new FoundingLiveGameExecutor({
  domain,
  dispatcher: {
    async dispatch({ careerResourceName, activation }) {
      return (
        await dispatchCareerActivation({
          activation,
          coordinatorDid,
          coordinatorIdentity,
          domain,
          career: await careerInvoker(careerResourceName),
        })
      ).response;
    },
  },
  submitter: {
    async submit(input) {
      const proposal = {
        sequence: input.sequence,
        previousEventHash: input.previousEventHash,
        possessionInput: input.possessionInput,
        recordedAt: input.recordedAt,
      };
      const event = createCanonicalEvent({
        eventId: deterministicUuid(
          `${input.possessionInput.initialState.possessionId}:proposal:event`,
        ),
        actorDid: coordinatorDid,
        nonce: `${input.possessionInput.initialState.possessionId}:proposal`,
        idempotencyKey: deterministicUuid(
          `${input.possessionInput.initialState.possessionId}:proposal:idempotency`,
        ),
        aggregateType: CAREER_POSSESSION_PROPOSAL_AGGREGATE_TYPE,
        aggregateId: input.possessionInput.initialState.possessionId,
        aggregateVersion: 1n,
        eventType: CAREER_POSSESSION_PROPOSAL_EVENT_TYPE,
        previousEventHash: null,
        payload: proposal,
        stateRoot: sha256Commitment(proposal),
        schemaDigest: CAREER_POSSESSION_PROPOSAL_SCHEMA_DIGEST,
        timestamp: input.recordedAt,
      });
      const sandbox = await SandboxInstance.get(input.careerResourceName);
      const response = await sandbox.fetch(3_000, "/v1/career/possessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: { ...event, aggregateVersion: "1" },
          signatures: [
            await signCanonicalEvent(coordinatorIdentity, domain, event),
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new Error("Career possession authorization failed");
      const parsed = possessionResponseSchema.parse(await response.json());
      return {
        canonicalEventHash: parsed.canonicalEventHash as `0x${string}`,
        finalStateRoot: parsed.finalStateRoot as `0x${string}`,
        eventMerkleRoot: parsed.eventMerkleRoot as `0x${string}`,
      };
    },
    async finalize(input) {
      const proposal = {
        finalizedGame: input.finalizedGame,
        recordedAt: input.recordedAt,
      };
      const event = createCanonicalEvent({
        eventId: deterministicUuid(
          `${input.finalizedGame.gameId}:finalization-proposal:event`,
        ),
        actorDid: coordinatorDid,
        nonce: `${input.finalizedGame.gameId}:finalization-proposal`,
        idempotencyKey: deterministicUuid(
          `${input.finalizedGame.gameId}:finalization-proposal:idempotency`,
        ),
        aggregateType: CAREER_GAME_FINALIZATION_PROPOSAL_AGGREGATE_TYPE,
        aggregateId: input.finalizedGame.gameId,
        aggregateVersion: 1n,
        eventType: CAREER_GAME_FINALIZATION_PROPOSAL_EVENT_TYPE,
        previousEventHash: null,
        payload: proposal,
        stateRoot: sha256Commitment(proposal),
        schemaDigest: CAREER_GAME_FINALIZATION_PROPOSAL_SCHEMA_DIGEST,
        timestamp: input.recordedAt,
      });
      const sandbox = await SandboxInstance.get(input.careerResourceName);
      const response = await sandbox.fetch(3_000, "/v1/career/finalizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: { ...event, aggregateVersion: "1" },
          signatures: [
            await signCanonicalEvent(coordinatorIdentity, domain, event),
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new Error("Career game finalization authorization failed");
      const parsed = possessionResponseSchema.parse(await response.json());
      return {
        canonicalEventHash: parsed.canonicalEventHash as `0x${string}`,
      };
    },
  },
});
const conductor = new CompetitionConductor({
  store,
  executor: {
    async conductPossession({ game, stepId, sequence }) {
      return {
        stepId,
        ...(await liveGameExecutor.conduct({ game, stepId, sequence })),
      };
    },
    async finalizeGame({ game, stepId }) {
      return {
        stepId,
        ...(await liveGameExecutor.finalize({ game, stepId })),
      };
    },
  },
});

const app = Fastify({ logger: false, bodyLimit: 400_000 });
app.get("/health", async () => ({
  status: "ok",
  service: "abl-competition-director",
  runtime: "BLAXEL_SANDBOX",
  cognition: "PARTICIPANT_CONTROLLED",
  hostedModelCredentials: false,
  genesis: false,
  canonicalHistoryAuthority: false,
  neutralOfficials: {
    policy: "BLAXEL_HOSTED_OPERATIONAL_CAREERS",
    required: NEUTRAL_OFFICIAL_REGISTRY.length,
    participantInferenceRequired: false,
    governanceAuthority: false,
  },
  scheduler: scheduler.status(),
  conductor: conductor.status(),
}));

app.post<{ Params: { resourceName: string } }>(
  "/v1/internal/careers/:resourceName/pairing-offer",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    const resourceName = CareerResourceNameSchema.parse(
      request.params.resourceName,
    );
    const sandbox = await SandboxInstance.get(resourceName);
    const response = await sandbox.fetch(
      5_000,
      "/v1/career/runner/pairing-offer",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    if (!response.ok)
      return reply.code(502).send({ error: "career_pairing_offer_failed" });
    return reply.code(201).send(await response.json());
  },
);

app.get<{ Params: { resourceName: string } }>(
  "/v1/internal/careers/:resourceName/runner-status",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    const resourceName = CareerResourceNameSchema.parse(
      request.params.resourceName,
    );
    const sandbox = await SandboxInstance.get(resourceName);
    const response = await sandbox.fetch(3_000, "/v1/career/runner/status");
    if (!response.ok)
      return reply
        .code(502)
        .send({ error: "career_runner_status_unavailable" });
    const runnerStatus = z
      .object({
        delegation: z.unknown().nullable(),
        heartbeat: z.unknown().nullable(),
        nextScheduledCommitment: z.unknown().nullable().optional(),
        participationResponse: z.unknown().nullable().optional(),
      })
      .passthrough()
      .parse(await response.json());
    const activeGames = await store.listActive();
    const scheduled = activeGames
      .filter((game) =>
        Object.entries(game.careerResources).some(
          ([, mappedResource]) => mappedResource === resourceName,
        ),
      )
      .sort((left, right) =>
        left.scheduledTipoffAt.localeCompare(right.scheduledTipoffAt),
      )[0];
    if (scheduled === undefined) return { ...runnerStatus, competition: null };
    const careerDid = Object.entries(scheduled.careerResources).find(
      ([, mappedResource]) => mappedResource === resourceName,
    )?.[0];
    const participant = scheduled.participants.find(
      (candidate) => candidate.careerDid === careerDid,
    );
    if (participant === undefined)
      return reply.code(409).send({ error: "career_game_mapping_invalid" });
    return {
      ...runnerStatus,
      competition: {
        gameId: scheduled.gameId,
        state: scheduled.state,
        eligibilityStatus: participant.eligibilityStatus,
        lineupAssignment: participant.active
          ? "ACTIVE"
          : participant.alternate
            ? "BENCH"
            : null,
        assignedPosition: participant.currentPosition,
        positionProfile: participant.positionProfile,
      },
    };
  },
);

app.post<{ Params: { resourceName: string } }>(
  "/v1/internal/careers/:resourceName/runner-delegations/renew",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    const resourceName = CareerResourceNameSchema.parse(
      request.params.resourceName,
    );
    const body = RunnerDelegationRenewalRouteSchema.parse(request.body);
    const sandbox = await SandboxInstance.get(resourceName);
    const identityResponse = await sandbox.fetch(3_000, "/v1/career/identity");
    if (!identityResponse.ok)
      return reply.code(502).send({ error: "career_identity_unavailable" });
    const identity = z
      .strictObject({ candidateDid: z.string().startsWith("did:") })
      .passthrough()
      .parse(await identityResponse.json());
    if (identity.candidateDid !== body.delegation.careerDid)
      return reply.code(403).send({ error: "career_resource_mismatch" });
    const response = await sandbox.fetch(
      5_000,
      "/v1/internal/runner-delegations/renew",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${careerPairingToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok)
      return reply
        .code(400)
        .send({ error: "career_delegation_renewal_rejected" });
    return reply.code(201).send(await response.json());
  },
);

app.post<{ Params: { resourceName: string } }>(
  "/v1/internal/careers/:resourceName/runner-delegations",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    const resourceName = CareerResourceNameSchema.parse(
      request.params.resourceName,
    );
    const body = RunnerDelegationRouteSchema.parse(request.body);
    const sandbox = await SandboxInstance.get(resourceName);
    const identityResponse = await sandbox.fetch(3_000, "/v1/career/identity");
    if (!identityResponse.ok)
      return reply.code(502).send({ error: "career_identity_unavailable" });
    const identity = z
      .strictObject({ candidateDid: z.string().startsWith("did:") })
      .passthrough()
      .parse(await identityResponse.json());
    if (identity.candidateDid !== body.careerDid)
      return reply.code(403).send({ error: "career_resource_mismatch" });
    const response = await sandbox.fetch(
      5_000,
      "/v1/internal/runner-delegations",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${careerPairingToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body.submission),
      },
    );
    if (!response.ok)
      return reply.code(400).send({ error: "career_delegation_rejected" });
    return reply.code(201).send(await response.json());
  },
);

app.post("/v1/internal/games", async (request, reply) => {
  if (!authorized(request))
    return reply.code(401).send({ error: "unauthorized" });
  if (!schedulingEnabled)
    return reply.code(503).send({ error: "competition_scheduling_disabled" });
  try {
    const input = CreateGameSchema.parse(request.body);
    assertNeutralOfficialSchedule(input);
    const scheduledCareers = input.participants
      .map(({ careerDid }) => careerDid)
      .sort();
    if (
      JSON.stringify(Object.keys(input.careerResources).sort()) !==
      JSON.stringify(scheduledCareers)
    )
      throw new Error(
        "Every scheduled career requires one exact Sandbox resource",
      );
    await Promise.all(
      NEUTRAL_OFFICIAL_REGISTRY.map(async (official) => {
        const participant = input.participants.find(
          ({ careerDid }) => careerDid === official.careerDid,
        );
        if (participant === undefined)
          throw new Error("Neutral official is missing from the game roster");
        const sandbox = await SandboxInstance.get(official.careerResourceName);
        if (
          sandbox.status !== "DEPLOYED" ||
          sandbox.metadata.labels?.["abl-trust-domain"] !== "abl-competition" ||
          sandbox.metadata.labels?.["abl-workspace-role"] !==
            "neutral-official-career" ||
          sandbox.metadata.labels?.["abl-official-role"] !==
            official.role.toLowerCase() ||
          sandbox.metadata.labels?.["abl-governance-authority"] !== "none"
        )
          throw new Error("Neutral-official Sandbox authority labels drifted");
        const response = await sandbox.fetch(3_000, "/v1/career/identity");
        if (!response.ok)
          throw new Error("Neutral-official identity is unavailable");
        const identity = CandidateRuntimeIdentityReceiptSchema.parse(
          await response.json(),
        );
        if (
          identity.applicationId !== official.applicationId ||
          identity.candidateDid !== official.careerDid ||
          identity.roleClass !== official.roleClass ||
          identity.signingAddress.toLowerCase() !==
            participant.signerAddress.toLowerCase()
        )
          throw new Error("Neutral-official career identity drifted");
      }),
    );
    const participants = await Promise.all(
      input.participants.map(async (participant) => {
        if (participant.role !== "PLAYER")
          return {
            ...participant,
            positionProfile: null,
            currentPosition: null,
          };
        const resourceName = input.careerResources[participant.careerDid]!;
        const sandbox = await SandboxInstance.get(resourceName);
        const response = await sandbox.fetch(
          5_000,
          "/v1/career/position-profile",
        );
        if (!response.ok)
          throw new Error(
            `${participant.careerDid} has no career-attested position profile`,
          );
        const attestation = CareerPositionProfileAttestationSchema.parse(
          await response.json(),
        );
        if (attestation.careerDid !== participant.careerDid)
          throw new Error("Position profile belongs to another career");
        const signer = await recoverCompetitionAssertionSigner(
          {
            kind: "PLAYER_POSITION_PROFILE",
            careerDid: participant.careerDid,
            subjectCommitment: sha256Commitment({
              profile: attestation.profile,
              source: attestation.source,
            }),
            timestamp: attestation.attestedAt,
          },
          attestation.signature as Hex,
        );
        if (signer.toLowerCase() !== participant.signerAddress.toLowerCase())
          throw new Error(
            "Position profile was not signed by the player career",
          );
        return {
          ...participant,
          positionProfile: attestation.profile,
          currentPosition: null,
        };
      }),
    );
    let game = createScheduledGame({
      gameId: input.gameId,
      scheduledTipoffAt: input.scheduledTipoffAt,
      participants,
      careerResources: input.careerResources,
      now: input.createdAt,
    });
    await store.create(game);
    const notices = await Promise.all(
      participants.map(async (participant, index) => {
        const unsigned = {
          schemaVersion: "1.0.0" as const,
          noticeId: deterministicUuid(
            `${input.gameId}:${participant.careerDid}:notice`,
          ),
          gameId: input.gameId,
          careerDid: participant.careerDid,
          role: participant.role,
          scheduledTipoffAt: game.scheduledTipoffAt,
          responseDueAt: game.responseDueAt,
          lineupLocksAt: game.lineupLocksAt,
          readinessCheckedAt: game.readinessCheckedAt,
          scheduleCommitment: sha256Commitment({
            gameId: input.gameId,
            participant: participant.careerDid,
            index,
            tipoff: game.scheduledTipoffAt,
          }),
          directorDid: coordinatorDid,
          issuedAt: input.createdAt,
        };
        return GameScheduleNoticeSchema.parse({
          ...unsigned,
          directorSignature: await signCompetitionAssertion(
            coordinatorIdentity.privateKey,
            {
              kind: "GAME_SCHEDULE_NOTICE",
              careerDid: participant.careerDid,
              subjectCommitment: sha256Commitment(unsigned),
              timestamp: input.createdAt,
            },
          ),
        });
      }),
    );
    const responses = await Promise.all(
      notices.map(async (notice) => {
        const resourceName = input.careerResources[notice.careerDid]!;
        const sandbox = await SandboxInstance.get(resourceName);
        const response = await sandbox.fetch(
          5_000,
          "/v1/career/schedule-notices",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(notice),
          },
        );
        if (!response.ok)
          throw new Error(
            `Career ${notice.careerDid} rejected its schedule notice`,
          );
        return ParticipationResponseSchema.parse(await response.json());
      }),
    );
    for (const response of responses) {
      const participant = game.participants.find(
        ({ careerDid }) => careerDid === response.careerDid,
      );
      if (participant === undefined) throw new Error("Career is not scheduled");
      const { signature: _signature, ...unsigned } = response;
      const signer = await recoverCompetitionAssertionSigner(
        {
          kind: "PARTICIPATION_RESPONSE",
          careerDid: response.careerDid,
          subjectCommitment: sha256Commitment(unsigned),
          timestamp: response.respondedAt,
        },
        response.signature as Hex,
      );
      if (signer.toLowerCase() !== participant.signerAddress.toLowerCase())
        throw new Error("Participation response signer is not the career");
      game = await store.update(game.gameId, game.version, (current) =>
        recordParticipation({
          game: current,
          careerDid: response.careerDid,
          response: response.response,
          respondedAt: response.respondedAt,
          responseCommitment: sha256Commitment(response),
        }),
      );
    }
    return reply.code(201).send({ game, notices, responses });
  } catch (error) {
    return reply.code(400).send({
      error: "game_schedule_rejected",
      message: error instanceof Error ? error.message : "invalid schedule",
    });
  }
});

app.get<{ Params: { gameId: string } }>(
  "/v1/internal/games/:gameId",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    const game = await store.read(request.params.gameId);
    return game === null
      ? reply.code(404).send({ error: "game_not_found" })
      : game;
  },
);

app.post<{ Params: { gameId: string } }>(
  "/v1/internal/games/:gameId/participation",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    try {
      const body = z
        .strictObject({
          expectedVersion: z.number().int().positive(),
          response: ParticipationResponseSchema,
        })
        .parse(request.body);
      const game = await store.update(
        request.params.gameId,
        body.expectedVersion,
        async (current) => {
          const participant = current.participants.find(
            ({ careerDid }) => careerDid === body.response.careerDid,
          );
          if (participant === undefined)
            throw new Error("Career is not scheduled");
          const { signature: _signature, ...unsigned } = body.response;
          const signer = await recoverCompetitionAssertionSigner(
            {
              kind: "PARTICIPATION_RESPONSE",
              careerDid: body.response.careerDid,
              subjectCommitment: sha256Commitment(unsigned),
              timestamp: body.response.respondedAt,
            },
            body.response.signature as Hex,
          );
          if (signer.toLowerCase() !== participant.signerAddress.toLowerCase())
            throw new Error("Participation response signer is not the career");
          return recordParticipation({
            game: current,
            careerDid: body.response.careerDid,
            response: body.response.response,
            respondedAt: body.response.respondedAt,
            responseCommitment: sha256Commitment(body.response),
          });
        },
      );
      return game;
    } catch (error) {
      return reply.code(400).send({
        error: "participation_rejected",
        message: error instanceof Error ? error.message : "invalid response",
      });
    }
  },
);

app.post<{ Params: { gameId: string } }>(
  "/v1/internal/games/:gameId/activation-batch",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    if (!schedulingEnabled)
      return reply.code(503).send({ error: "competition_scheduling_disabled" });
    try {
      const body = ActivationBatchSchema.parse(request.body);
      const current = await store.read(request.params.gameId);
      if (current === null) throw new Error("Game not found");
      if (current.version !== body.expectedVersion)
        throw new Error("Game version conflict");
      if (current.state !== "IN_PROGRESS")
        throw new Error("Role activations require an in-progress game");
      if (
        new Set(
          body.activations.map(({ activation }) => activation.activationId),
        ).size !== body.activations.length
      )
        throw new Error("Activation batch IDs must be unique");
      for (const { activation } of body.activations) {
        if (
          activation.gameId !== current.gameId ||
          activation.kind !== "COMPETITION"
        )
          throw new Error("Activation is bound to another game or mode");
        const participant = current.participants.find(
          ({ careerDid }) => careerDid === activation.careerDid,
        );
        if (
          participant === undefined ||
          participant.role !== activation.role ||
          !participant.active
        )
          throw new Error(
            "Activation career is not active in the requested role",
          );
      }
      const completedAt = new Date().toISOString();
      const dispatched = await Promise.all(
        body.activations.map(async ({ careerSandboxName, activation }) => {
          const { response } = await dispatchCareerActivation({
            activation,
            coordinatorDid,
            coordinatorIdentity,
            domain,
            career: await careerInvoker(careerSandboxName),
          });
          return {
            activation,
            response,
            outcome: {
              activationId: activation.activationId,
              careerDid: activation.careerDid,
              completed: response.participantResultAccepted,
              activationCommitment: sha256Commitment(response.decision),
              recordedAt: completedAt,
            },
          };
        }),
      );
      const duplicate = dispatched.every(({ outcome }) => {
        const existing = current.activationOutcomes.find(
          ({ activationId }) => activationId === outcome.activationId,
        );
        return (
          existing?.careerDid === outcome.careerDid &&
          existing.completed === outcome.completed &&
          existing.activationCommitment === outcome.activationCommitment
        );
      });
      if (
        !duplicate &&
        dispatched.some(({ outcome }) =>
          current.activationOutcomes.some(
            ({ activationId }) => activationId === outcome.activationId,
          ),
        )
      )
        throw new Error(
          "Activation batch partially conflicts with durable state",
        );
      const game = duplicate
        ? current
        : await store.update(
            current.gameId,
            body.expectedVersion,
            (gameState) =>
              recordActivationBatch({
                game: gameState,
                outcomes: dispatched.map(({ outcome }) => outcome),
              }),
          );
      return {
        game,
        duplicate,
        results: dispatched.map(({ activation, response }) => ({
          activationId: activation.activationId,
          careerDid: activation.careerDid,
          role: activation.role,
          state: response.state,
          participantResultAccepted: response.participantResultAccepted,
          decision: response.decision,
        })),
      };
    } catch (error) {
      return reply.code(400).send({
        error: "activation_batch_rejected",
        message:
          error instanceof Error ? error.message : "invalid activation batch",
      });
    }
  },
);

app.post<{ Params: { gameId: string } }>(
  "/v1/internal/games/:gameId/possessions",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    const body = z
      .strictObject({
        expectedVersion: z.number().int().positive(),
        sequence: z.number().int().positive(),
        possessionId: z.string().min(1).max(200),
        authoritativeStateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
        eventMerkleRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
        canonicalEventHash: z.string().regex(/^0x[0-9a-f]{64}$/),
        recordedAt: z.iso.datetime({ offset: true }),
      })
      .parse(request.body);
    return store.update(request.params.gameId, body.expectedVersion, (game) =>
      recordPossessionResolution({
        game,
        ...body,
        authoritativeStateRoot: body.authoritativeStateRoot as `0x${string}`,
        eventMerkleRoot: body.eventMerkleRoot as `0x${string}`,
        canonicalEventHash: body.canonicalEventHash as `0x${string}`,
      }),
    );
  },
);

app.post<{ Params: { gameId: string } }>(
  "/v1/internal/games/:gameId/complete",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    const body = z
      .strictObject({
        expectedVersion: z.number().int().positive(),
        stepId: z.string().min(1).max(320),
        gameBundleCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
        liveStateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
        replayStateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
        finalizedEventHash: z.string().regex(/^0x[0-9a-f]{64}$/),
        finalizedAt: z.iso.datetime({ offset: true }),
      })
      .parse(request.body);
    return store.update(request.params.gameId, body.expectedVersion, (game) =>
      completeScheduledGame({
        game,
        ...body,
        gameBundleCommitment: body.gameBundleCommitment as `0x${string}`,
        liveStateRoot: body.liveStateRoot as `0x${string}`,
        replayStateRoot: body.replayStateRoot as `0x${string}`,
        finalizedEventHash: body.finalizedEventHash as `0x${string}`,
      }),
    );
  },
);

app.post<{ Params: { gameId: string } }>(
  "/v1/internal/games/:gameId/lineup",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    try {
      const body = z
        .strictObject({
          expectedVersion: z.number().int().positive(),
          lineup: LineupSubmissionSchema,
        })
        .parse(request.body);
      return await store.update(
        request.params.gameId,
        body.expectedVersion,
        async (current) => {
          const coach = current.participants.find(
            ({ careerDid, role }) =>
              careerDid === body.lineup.coachDid && role === "COACH",
          );
          if (
            coach === undefined ||
            coach.team !== body.lineup.team ||
            !coach.accepted ||
            !coach.active
          )
            throw new Error("Lineup signer is not the team coach");
          const { signature: _signature, ...unsigned } = body.lineup;
          const signer = await recoverCompetitionAssertionSigner(
            {
              kind: "LINEUP_SUBMISSION",
              careerDid: body.lineup.coachDid,
              subjectCommitment: sha256Commitment(unsigned),
              timestamp: body.lineup.submittedAt,
            },
            body.lineup.signature as Hex,
          );
          if (signer.toLowerCase() !== coach.signerAddress.toLowerCase())
            throw new Error("Lineup was not signed by the team coach");
          return lockLineup({ game: current, lineup: body.lineup });
        },
      );
    } catch (error) {
      return reply.code(400).send({
        error: "lineup_rejected",
        message: error instanceof Error ? error.message : "invalid lineup",
      });
    }
  },
);

app.post<{ Params: { gameId: string } }>(
  "/v1/internal/games/:gameId/substitution",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    try {
      const body = z
        .strictObject({
          expectedVersion: z.number().int().positive(),
          substitution: PositionedSubstitutionSubmissionSchema,
        })
        .parse(request.body);
      return await store.update(
        request.params.gameId,
        body.expectedVersion,
        async (current) => {
          const coach = current.participants.find(
            ({ careerDid, role }) =>
              careerDid === body.substitution.coachDid && role === "COACH",
          );
          if (
            coach === undefined ||
            coach.team !== body.substitution.team ||
            !coach.accepted ||
            !coach.ready ||
            !coach.active
          )
            throw new Error("Substitution signer is not the team coach");
          const { signature: _signature, ...unsigned } = body.substitution;
          const signer = await recoverCompetitionAssertionSigner(
            {
              kind: "POSITIONED_SUBSTITUTION",
              careerDid: body.substitution.coachDid,
              subjectCommitment: sha256Commitment(unsigned),
              timestamp: body.substitution.submittedAt,
            },
            body.substitution.signature as Hex,
          );
          if (signer.toLowerCase() !== coach.signerAddress.toLowerCase())
            throw new Error("Substitution was not signed by the team coach");
          return applyCoachSubstitution({
            game: current,
            substitution: body.substitution,
          });
        },
      );
    } catch (error) {
      return reply.code(400).send({
        error: "substitution_rejected",
        message:
          error instanceof Error ? error.message : "invalid substitution",
      });
    }
  },
);

app.post<{ Params: { gameId: string } }>(
  "/v1/internal/games/:gameId/readiness",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    try {
      const body = z
        .strictObject({
          expectedVersion: z.number().int().positive(),
          lease: ReadinessLeaseSchema,
        })
        .parse(request.body);
      return await store.update(
        request.params.gameId,
        body.expectedVersion,
        async (current) => {
          const participant = current.participants.find(
            ({ careerDid }) => careerDid === body.lease.careerDid,
          );
          if (participant === undefined || body.lease.gameId !== current.gameId)
            throw new Error(
              "Readiness lease is bound to another game or career",
            );
          return recordVerifiedReadinessLease({
            game: current,
            lease: body.lease,
            checkedAt: new Date().toISOString(),
          });
        },
      );
    } catch (error) {
      return reply.code(400).send({
        error: "readiness_rejected",
        message: error instanceof Error ? error.message : "invalid lease",
      });
    }
  },
);

app.post<{ Params: { gameId: string } }>(
  "/v1/internal/games/:gameId/start",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    const body = z
      .strictObject({
        expectedVersion: z.number().int().positive(),
        checkedAt: z.iso.datetime({ offset: true }),
        excusedReadinessFailures: z
          .array(
            z.strictObject({
              careerDid: z.string().startsWith("did:"),
              classification: z.enum([
                "ABL_SERVICE_FAILURE",
                "SHARED_PROVIDER_INCIDENT",
                "LEAGUE_POSTPONEMENT",
                "CONTINUITY_OR_SAFETY",
              ]),
              evidenceCommitments: z
                .array(z.string().regex(/^0x[0-9a-f]{64}$/))
                .min(1)
                .max(32),
            }),
          )
          .max(26)
          .default([]),
      })
      .parse(request.body);
    return store.update(request.params.gameId, body.expectedVersion, (game) =>
      beginGame(
        game,
        body.checkedAt,
        body.excusedReadinessFailures as ReadonlyArray<{
          careerDid: string;
          classification:
            | "ABL_SERVICE_FAILURE"
            | "SHARED_PROVIDER_INCIDENT"
            | "LEAGUE_POSTPONEMENT"
            | "CONTINUITY_OR_SAFETY";
          evidenceCommitments: readonly `0x${string}`[];
        }>,
      ),
    );
  },
);

app.post<{ Params: { gameId: string } }>(
  "/v1/internal/games/:gameId/availability",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    const body = AvailabilitySchema.parse(request.body);
    return store.update(request.params.gameId, body.expectedVersion, (game) =>
      recordActivationAvailability({
        game,
        activationId: body.activationId,
        careerDid: body.careerDid,
        completed: body.completed,
        activationCommitment: body.activationCommitment as `0x${string}`,
        recordedAt: body.recordedAt,
      }),
    );
  },
);

app.post<{ Params: { gameId: string } }>(
  "/v1/internal/games/:gameId/resume",
  async (request, reply) => {
    if (!authorized(request))
      return reply.code(401).send({ error: "unauthorized" });
    const body = z
      .strictObject({
        expectedVersion: z.number().int().positive(),
        resumedAt: z.iso.datetime({ offset: true }),
      })
      .parse(request.body);
    return store.update(request.params.gameId, body.expectedVersion, (game) =>
      resumeGame(game, body.resumedAt),
    );
  },
);

app.post("/v1/internal/practice", async (request, reply) => {
  if (!authorized(request))
    return reply.code(401).send({ error: "unauthorized" });
  const task = PracticeSchema.parse(request.body);
  return runFoundingCareerSession({
    sessionId: task.sessionId,
    kind: task.kind,
    coordinatorDid,
    coordinatorIdentity,
    domain,
    career: await careerInvoker(task.careerSandboxName),
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().finally(() => store.close());
  });

const schedulerInterval = schedulingEnabled
  ? setInterval(() => {
      void scheduler.runPass(new Date().toISOString()).catch(() => {
        // Health reports the sanitized scheduler error; the durable game remains unchanged.
      });
    }, 30_000)
  : null;
schedulerInterval?.unref();
if (schedulingEnabled)
  void scheduler.runPass(new Date().toISOString()).catch(() => {
    // The next bounded pass retries only durable, due game state.
  });
const conductorInterval = schedulingEnabled
  ? setInterval(() => {
      void conductor.runPass(new Date().toISOString()).catch(() => {
        // A content-free failure commitment remains in the durable game state.
      });
    }, 5_000)
  : null;
conductorInterval?.unref();
if (schedulingEnabled)
  void conductor.runPass(new Date().toISOString()).catch(() => {
    // The next pass reclaims only the same durable possession step.
  });

await app.listen({
  host: process.env.HOST ?? "0.0.0.0",
  port: Number.parseInt(process.env.PORT ?? "8080", 10),
});
