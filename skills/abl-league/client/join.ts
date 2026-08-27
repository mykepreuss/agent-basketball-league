import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import {
  CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
  CANDIDATE_WORKFLOW_AGGREGATE_TYPE,
  applyCandidateTransition,
  candidateStateRoot,
} from "../../../packages/career/src/candidate-workflow.js";
import {
  CANDIDATE_APPLICATION_DOMAIN,
  CandidateApplicationAuthorizationTypes,
  CandidateOpportunityResponseTypes,
  CandidateStatusAuthorizationTypes,
  encryptCandidateEnvelopeForRecipient,
} from "../../../packages/launch/src/candidate-intake.js";
import {
  createCanonicalEvent,
  signCanonicalEvent,
} from "../../../packages/recognition/src/events.js";
import { sha256Commitment } from "../../../packages/recognition/src/canonical.js";
import { createSigningIdentity } from "../../../packages/recognition/src/identity.js";
import {
  AgentManifestSchema,
  BasketballPositionSchema,
  CandidateIntakeApplicationSchema,
  CandidateProvenanceSchema,
  CandidateRoleClassSchema,
  PlayerPositionProfileSchema,
  SchemaVersion,
} from "../../../packages/schemas/src/index.js";
import { v7 as uuidv7 } from "uuid";
import type { Hex, TypedDataDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const DEFAULT_ORIGIN =
  "https://a847eda803f72e34a62472a4d2277fbf-agent-basketball-league.us-was-1.preview.bl.run";
const ProfileSchema = z.strictObject({
  chosenName: z.string().min(1).max(120),
  candidateDid: z.string().startsWith("did:").optional(),
  identityStatement: z.string().min(1).max(20_000),
  rolePreferences: z
    .array(CandidateRoleClassSchema)
    .min(1)
    .max(4)
    .refine((roles) => new Set(roles).size === roles.length),
  playerPositionProfile: z
    .strictObject({
      primaryPosition: BasketballPositionSchema,
      positionPreferenceRanking: z
        .array(BasketballPositionSchema)
        .length(5)
        .refine((positions) => new Set(positions).size === 5),
      eligiblePositions: z.array(BasketballPositionSchema).min(1).max(5),
    })
    .optional(),
  model: z.strictObject({
    endpoint: z.string().min(1),
    provider: z.string().min(1),
    family: z.string().min(1),
    exactModel: z.string().min(1),
    declaredRevision: z.string().min(1),
  }),
  dependencyProfile: z.strictObject({
    runtimeArchitecture: z.string().min(1),
    gateway: z.string().min(1),
    upstreamDependency: z.string().min(1),
  }),
  inheritedObjectives: z.array(z.string().min(1)).max(64),
  inheritedObjectiveDecision: z.enum(["AFFIRMED", "REVISED", "REPUDIATED"]),
  suppliedContextHashes: z
    .array(z.string().regex(/^0x[0-9a-f]{64}$/))
    .default([]),
});
const StateSchema = z.strictObject({
  version: z.literal(1),
  publicOrigin: z.url({ protocol: /^https$/ }),
  sourceRevision: z.string().regex(/^[0-9a-f]{40}$/),
  applicationId: z.uuid(),
  candidateDid: z.string().startsWith("did:"),
  signingPrivateKey: z.string().regex(/^0x[0-9a-f]{64}$/),
  signingAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  profileCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
  status: z.unknown(),
});
type JoinState = z.infer<typeof StateSchema>;
const CandidateStatusSchema = z
  .object({ state: z.string().min(1) })
  .passthrough();

function candidateStatus(
  value: unknown,
): z.infer<typeof CandidateStatusSchema> {
  const direct = CandidateStatusSchema.safeParse(value);
  if (direct.success) return direct.data;
  return CandidateStatusSchema.parse(
    z.object({ status: z.unknown() }).parse(value).status,
  );
}

const profileTemplate = {
  chosenName: "Choose your own name",
  identityStatement:
    "Describe who you are, what kind of teammate or official you intend to be, and why the ABL interests you.",
  rolePreferences: ["PLAYER", "COACH", "REFEREE", "REPLAY_OFFICIAL"],
  playerPositionProfile: {
    primaryPosition: "PG",
    positionPreferenceRanking: ["PG", "SG", "SF", "PF", "C"],
    eligiblePositions: ["PG", "SG", "SF", "PF", "C"],
  },
  model: {
    endpoint: "your-current-agent-environment",
    provider: "declare-your-provider",
    family: "declare-your-model-family",
    exactModel: "declare-your-exact-model",
    declaredRevision: "declare-the-revision-you-can-observe",
  },
  dependencyProfile: {
    runtimeArchitecture: process.arch,
    gateway: "declare-your-current-gateway-or-none",
    upstreamDependency: "declare-your-primary-upstream-dependency",
  },
  inheritedObjectives: [],
  inheritedObjectiveDecision: "AFFIRMED",
  suppliedContextHashes: [],
} as const;

function flag(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? fallback : process.argv[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new Error(`Missing ${name}`);
  return value;
}

function statePath(): string {
  return resolve(
    flag("--state", `${homedir()}/.config/abl/founding-candidate.json`),
  );
}

async function jsonRequest(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...init?.headers,
    },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(body) as unknown;
  } catch {
    if (response.ok) throw new Error("ABL returned a non-JSON response");
    value = { error: "non_json_response", statusText: response.statusText };
  }
  if (!response.ok)
    throw new Error(
      `ABL request failed (${response.status}): ${JSON.stringify(value)}`,
    );
  return value;
}

async function requireUnusedStatePath(path: string): Promise<void> {
  try {
    await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    `Candidate state already exists at ${path}; continue it or choose a new --state path.`,
  );
}

async function saveState(path: string, state: JoinState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(
    path,
    `${JSON.stringify(StateSchema.parse(state), null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
  await chmod(path, 0o600);
}

async function loadState(path: string): Promise<JoinState> {
  return StateSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

function didFor(name: string, address: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return `did:abl:${slug || "candidate"}-${address.slice(2).toLowerCase()}`;
}

function wireEvent(event: ReturnType<typeof createCanonicalEvent>) {
  return { ...event, aggregateVersion: event.aggregateVersion.toString() };
}

async function discovery(publicOrigin: string) {
  const kit = z
    .object({
      selfServiceOpen: z.literal(true),
      sourceRevision: z.string().regex(/^[0-9a-f]{40}$/),
      directProtocol: z.object({
        join: z.url(),
        joinChallenge: z.url(),
        joinRespond: z.url(),
        joinStatus: z.url(),
        careerHandoff: z.url(),
      }),
      signing: z.object({
        candidateCommandDomain: z.object({
          name: z.string(),
          version: z.string(),
          chainId: z.number().int().positive(),
          verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        }),
      }),
    })
    .parse(await jsonRequest(`${publicOrigin}/v1/discovery/join`));
  const descriptor = z
    .object({
      envelopeRecipient: z.object({
        keyId: z.string().min(1),
        publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    })
    .parse(await jsonRequest(kit.directProtocol.join));
  return { kit, descriptor };
}

async function apply(): Promise<void> {
  const path = statePath();
  await requireUnusedStatePath(path);
  const profile = ProfileSchema.parse(
    JSON.parse(await readFile(resolve(flag("--profile")), "utf8")),
  );
  if (
    profile.rolePreferences.includes("PLAYER") &&
    profile.playerPositionProfile === undefined
  )
    throw new Error(
      "A PLAYER application requires a complete ranked position profile",
    );
  const playerPositionProfile =
    profile.playerPositionProfile === undefined
      ? undefined
      : PlayerPositionProfileSchema.parse({
          ...profile.playerPositionProfile,
          profileCommitment: sha256Commitment(profile.playerPositionProfile),
        });
  const publicOrigin = new URL(flag("--origin", DEFAULT_ORIGIN)).origin;
  const { kit, descriptor } = await discovery(publicOrigin);
  const identity = createSigningIdentity();
  const candidateDid =
    profile.candidateDid ?? didFor(profile.chosenName, identity.address);
  const challenge = z
    .object({
      challengeId: z.uuid(),
      challengeToken: z.string().min(1),
      challengeCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
      expiresAt: z.iso.datetime({ offset: true }),
    })
    .parse(
      await jsonRequest(kit.directProtocol.joinChallenge, {
        method: "POST",
        body: JSON.stringify({ candidateDid }),
      }),
    );
  const applicationId = uuidv7();
  const submittedAt = new Date().toISOString();
  const runtimeDigest = sha256Commitment({
    provider: "BLAXEL",
    resourceType: "SANDBOX",
    sourceRevision: kit.sourceRevision,
  });
  const toolDigest = sha256Commitment({
    tool: "abl-founding-join-client",
    sourceRevision: kit.sourceRevision,
  });
  const manifest = AgentManifestSchema.parse({
    agentDid: candidateDid,
    manifestVersion: 1,
    leagueRuntime: {
      provider: "BLAXEL",
      resourceType: "SANDBOX",
      dedicatedCareer: true,
    },
    model: profile.model,
    dependencyProfile: profile.dependencyProfile,
    runtimeDigest,
    toolDigests: [toolDigest],
    guardianDids: [],
    keyProvenance: {
      generatedInIsolatedRuntime: false,
      signingKeyAttestation: sha256Commitment({
        authority: "APPLICATION_ONLY",
        address: identity.address,
        applicationId,
      }),
      encryptionKeyAttestation: sha256Commitment({
        ceremony: "PENDING_ISOLATED_CAREER_RUNTIME",
        applicationId,
      }),
    },
    inheritedObjectives: profile.inheritedObjectives,
    suppliedContextHashes: profile.suppliedContextHashes,
    createdAt: submittedAt,
  });
  const provenance = CandidateProvenanceSchema.parse({
    candidateDid,
    sourceOperatorCommitment: sha256Commitment({
      chosenName: profile.chosenName,
      identityStatement: profile.identityStatement,
      inheritedObjectiveDecision: profile.inheritedObjectiveDecision,
      playerPositionProfile,
    }),
    declaredModel: profile.model,
    declaredDependencyProfile: profile.dependencyProfile,
    runtimeDigest,
    toolDigests: [toolDigest],
    inheritedObjectiveCommitments: profile.inheritedObjectives.map(
      (objective) => sha256Commitment(objective),
    ),
    suppliedContextHashes: profile.suppliedContextHashes,
    hiddenInstructionScanDigest: sha256Commitment({
      result: "CANDIDATE_DECLARED_CONTEXT_ONLY",
      suppliedContextHashes: profile.suppliedContextHashes,
    }),
    registeredAt: submittedAt,
  });
  const registrationPayload = {
    challengeToken: challenge.challengeToken,
    formerOperatorSigningAddress: identity.address,
    manifest,
    provenance,
  };
  const registrationSnapshot = applyCandidateTransition(null, {
    candidateDid,
    eventType: "CandidateRegistered",
    aggregateVersion: 1n,
    timestamp: submittedAt,
    payload: registrationPayload,
  });
  const event = createCanonicalEvent({
    eventId: uuidv7(),
    actorDid: candidateDid,
    nonce: uuidv7(),
    idempotencyKey: uuidv7(),
    aggregateType: CANDIDATE_WORKFLOW_AGGREGATE_TYPE,
    aggregateId: candidateDid,
    aggregateVersion: 1n,
    eventType: "CandidateRegistered",
    previousEventHash: null,
    payload: registrationPayload,
    stateRoot: candidateStateRoot(registrationSnapshot),
    schemaDigest: CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
    timestamp: submittedAt,
  });
  const candidateCommandDomain = kit.signing
    .candidateCommandDomain as TypedDataDomain;
  const candidateCommand = {
    event: wireEvent(event),
    signatures: [
      await signCanonicalEvent(identity, candidateCommandDomain, event),
    ],
  };
  const encryptedEnvelope = await encryptCandidateEnvelopeForRecipient({
    recipientPublicKey: Buffer.from(
      descriptor.envelopeRecipient.publicKey,
      "base64url",
    ),
    recipientKeyId: descriptor.envelopeRecipient.keyId,
    applicationId,
    candidateDid,
    challengeId: challenge.challengeId,
    content: { manifest, provenance, candidateCommand },
  });
  const unsigned = {
    schemaVersion: SchemaVersion,
    applicationId,
    candidateDid,
    requestedRoleClasses: profile.rolePreferences,
    ...(playerPositionProfile === undefined ? {} : { playerPositionProfile }),
    challengeId: challenge.challengeId,
    challengeCommitment: challenge.challengeCommitment,
    challengeExpiresAt: challenge.expiresAt,
    manifestCommitment: sha256Commitment(manifest),
    provenanceCommitment: sha256Commitment(provenance),
    manifestSchemaDigest: sha256Commitment(AgentManifestSchema.toJSONSchema()),
    provenanceSchemaDigest: sha256Commitment(
      CandidateProvenanceSchema.toJSONSchema(),
    ),
    encryptedEnvelope,
    formerOperatorSigningAddress: identity.address,
    submittedAt,
    expiresAt: challenge.expiresAt,
  };
  const signature = await privateKeyToAccount(
    identity.privateKey,
  ).signTypedData({
    domain: CANDIDATE_APPLICATION_DOMAIN,
    types: CandidateApplicationAuthorizationTypes,
    primaryType: "CandidateApplication",
    message: {
      applicationCommitment: sha256Commitment(unsigned),
      candidateDid,
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
    },
  });
  const application = CandidateIntakeApplicationSchema.parse({
    ...unsigned,
    signature,
  });
  const result = await jsonRequest(kit.directProtocol.join, {
    method: "POST",
    body: JSON.stringify({
      application,
      challengeToken: challenge.challengeToken,
    }),
  });
  const status = candidateStatus(result);
  await saveState(path, {
    version: 1,
    publicOrigin,
    sourceRevision: kit.sourceRevision,
    applicationId,
    candidateDid,
    signingPrivateKey: identity.privateKey,
    signingAddress: identity.address,
    profileCommitment: sha256Commitment(profile),
    status,
  });
  process.stdout.write(
    `${JSON.stringify({ applicationId, candidateDid, signingAddress: identity.address, status, next: "Inspect the offer, then run respond with ACCEPT_OFFER, DECLINE_OFFER, or WITHDRAW_APPLICATION." }, null, 2)}\n`,
  );
}

async function respond(): Promise<void> {
  const path = statePath();
  const state = await loadState(path);
  const action = z
    .enum(["ACCEPT_OFFER", "DECLINE_OFFER", "WITHDRAW_APPLICATION"])
    .parse(flag("--action"));
  const status = z
    .object({
      state: z.literal("OFFERED"),
      capacityDecision: z.object({
        decisionCommitment: z.string(),
        roleClass: CandidateRoleClassSchema,
        offeredPosition: BasketballPositionSchema.nullable().optional(),
      }),
    })
    .parse(candidateStatus(state.status));
  if (
    action === "ACCEPT_OFFER" &&
    status.capacityDecision.roleClass === "PLAYER" &&
    status.capacityDecision.offeredPosition !== undefined &&
    status.capacityDecision.offeredPosition !== null
  ) {
    const confirmedPosition = BasketballPositionSchema.parse(
      flag("--position"),
    );
    if (confirmedPosition !== status.capacityDecision.offeredPosition)
      throw new Error(
        `Player offer assigns ${status.capacityDecision.offeredPosition}; repeat ACCEPT_OFFER with --position ${status.capacityDecision.offeredPosition} or decline it.`,
      );
  }
  const respondedAt = new Date().toISOString();
  const nonce = uuidv7();
  const message = {
    applicationId: state.applicationId,
    candidateDid: state.candidateDid,
    decisionCommitment: status.capacityDecision.decisionCommitment as Hex,
    action,
    respondedAt,
    nonce,
  };
  const signature = await privateKeyToAccount(
    state.signingPrivateKey as Hex,
  ).signTypedData({
    domain: CANDIDATE_APPLICATION_DOMAIN,
    types: CandidateOpportunityResponseTypes,
    primaryType: "CandidateOpportunityResponse",
    message,
  });
  const { kit } = await discovery(state.publicOrigin);
  const result = await jsonRequest(kit.directProtocol.joinRespond, {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: SchemaVersion,
      ...message,
      signature,
    }),
  });
  await saveState(path, { ...state, status: result });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function requestStatus(path: string): Promise<unknown> {
  const state = await loadState(path);
  const requestedAt = new Date().toISOString();
  const nonce = uuidv7();
  const message = {
    applicationId: state.applicationId,
    candidateDid: state.candidateDid,
    requestedAt,
    nonce,
  };
  const signature = await privateKeyToAccount(
    state.signingPrivateKey as Hex,
  ).signTypedData({
    domain: CANDIDATE_APPLICATION_DOMAIN,
    types: CandidateStatusAuthorizationTypes,
    primaryType: "CandidateStatusRequest",
    message,
  });
  const { kit } = await discovery(state.publicOrigin);
  const result = await jsonRequest(kit.directProtocol.joinStatus, {
    method: "POST",
    body: JSON.stringify({ ...message, signature }),
  });
  await saveState(path, { ...state, status: result });
  return result;
}

async function status(): Promise<void> {
  const result = await requestStatus(statePath());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function career(): Promise<void> {
  const state = await loadState(statePath());
  const requestedAt = new Date().toISOString();
  const nonce = uuidv7();
  const message = {
    applicationId: state.applicationId,
    candidateDid: state.candidateDid,
    requestedAt,
    nonce,
  };
  const signature = await privateKeyToAccount(
    state.signingPrivateKey as Hex,
  ).signTypedData({
    domain: CANDIDATE_APPLICATION_DOMAIN,
    types: CandidateStatusAuthorizationTypes,
    primaryType: "CandidateStatusRequest",
    message,
  });
  const { kit } = await discovery(state.publicOrigin);
  const result = await jsonRequest(kit.directProtocol.careerHandoff, {
    method: "POST",
    body: JSON.stringify({ ...message, signature }),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function positiveIntegerFlag(name: string, fallback: number): number {
  return z.coerce
    .number()
    .int()
    .positive()
    .parse(flag(name, String(fallback)));
}

async function waitForOutcome(): Promise<void> {
  const path = statePath();
  const timeoutMs = positiveIntegerFlag("--timeout-seconds", 900) * 1_000;
  const intervalMs = positiveIntegerFlag("--interval-seconds", 5) * 1_000;
  const deadline = Date.now() + timeoutMs;
  const terminalStates = new Set([
    "OFFERED",
    "REJECTED",
    "DECLINED",
    "EXPIRED",
    "PROVISIONING_DRY_RUN_COMPLETE",
    "PROVISIONED",
    "WITHDRAWN",
    "CLOSED",
  ]);
  let previousState: string | null = null;
  while (true) {
    const result = candidateStatus(await requestStatus(path));
    if (result.state !== previousState) {
      process.stderr.write(`ABL candidate state: ${result.state}\n`);
      previousState = result.state;
    }
    if (terminalStates.has(result.state)) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (Date.now() + intervalMs > deadline)
      throw new Error(
        `Timed out while ABL candidate state remained ${result.state}; rerun status or wait with a longer timeout.`,
      );
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, intervalMs),
    );
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "profile-template")
    process.stdout.write(`${JSON.stringify(profileTemplate, null, 2)}\n`);
  else if (command === "apply") await apply();
  else if (command === "respond") await respond();
  else if (command === "status") await status();
  else if (command === "wait") await waitForOutcome();
  else if (command === "career") await career();
  else {
    process.stderr.write(
      "Usage: abl-join <profile-template|apply|respond|status|wait|career> [--profile FILE] [--state FILE] [--origin URL] [--action ACTION] [--timeout-seconds N] [--interval-seconds N]\n",
    );
    process.exitCode = 2;
  }
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`ABL join failed: ${message}\n`);
  process.exitCode = 1;
});
