import { governmentThresholds } from "@abl/policy";
import { sha256Commitment } from "@abl/recognition";
import {
  DidSchema,
  IsoDateTimeSchema,
  ReleaseManifestBodySchema,
  ReleaseManifestSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

export const RELEASE_WORKFLOW_AGGREGATE_TYPE = "software-release";
export const RELEASE_WORKFLOW_EVENT_TYPES = [
  "ReleaseProposed",
  "ReleaseApproved",
  "ReleaseStayed",
  "ReleaseAuthorized",
] as const;
export type ReleaseWorkflowEventType =
  (typeof RELEASE_WORKFLOW_EVENT_TYPES)[number];

export const ReleaseInstitutionalRoleSchema = z.enum([
  "COMMISSIONER",
  "INTEGRITY",
  "TRIBUNAL",
]);

export const ReleaseVerifierResultSchema = z.strictObject({
  format: z.literal("ABL-PUBLIC-VERIFIER-RESULT-V1"),
  releaseId: UuidV7Schema,
  releaseVersion: z.number().int().positive(),
  sourceDigest: Sha256Schema,
  imageDigests: z
    .array(Sha256Schema)
    .min(1)
    .refine((values) => new Set(values).size === values.length),
  schemaDigest: Sha256Schema,
  migrationDigest: Sha256Schema,
  testResultDigest: Sha256Schema,
  result: z.literal("PASS"),
  verifiedAt: IsoDateTimeSchema,
});

export const ReleaseVerifierResultRegistrySchema = z
  .record(Sha256Schema, ReleaseVerifierResultSchema)
  .refine((records) => Object.keys(records).length > 0)
  .superRefine((records, context) => {
    for (const [digest, result] of Object.entries(records)) {
      if (releaseVerifierResultDigest(result) !== digest) {
        context.addIssue({
          code: "custom",
          message: "Release verifier registry key does not match its result",
          path: [digest],
        });
      }
    }
  });

export const ReleaseProposalPayloadSchema = z.strictObject({
  manifest: ReleaseManifestBodySchema,
  verifierResult: ReleaseVerifierResultSchema,
  ratificationProposalIds: z
    .array(UuidV7Schema)
    .refine((values) => new Set(values).size === values.length),
});

export const ReleaseApprovalCommandSchema = z.strictObject({
  approverDid: DidSchema,
  role: ReleaseInstitutionalRoleSchema,
  releaseId: UuidV7Schema,
  releaseVersion: z.number().int().positive(),
  manifestCommitment: Sha256Schema,
  approvedAt: IsoDateTimeSchema,
});
export const ReleaseApprovalPayloadSchema = z.strictObject({
  command: ReleaseApprovalCommandSchema,
});

export const ReleaseStayCommandSchema = z.strictObject({
  releaseId: UuidV7Schema,
  manifestCommitment: Sha256Schema,
  participatingTribunalDids: z.array(DidSchema).length(3),
  recusedTribunalDids: z.array(DidSchema).max(5),
  reasonedPublicCommitment: Sha256Schema,
  stayedAt: IsoDateTimeSchema,
});
export const ReleaseStayPayloadSchema = z.strictObject({
  command: ReleaseStayCommandSchema,
});

export const ReleaseAuthorizationCommandSchema = z.strictObject({
  releaseId: UuidV7Schema,
  releaseVersion: z.number().int().positive(),
  manifestCommitment: Sha256Schema,
  authorizedAt: IsoDateTimeSchema,
});
export const ReleaseAuthorizationPayloadSchema = z.strictObject({
  command: ReleaseAuthorizationCommandSchema,
});

export type ReleaseManifestBody = z.infer<typeof ReleaseManifestBodySchema>;
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;
export type ReleaseVerifierResult = z.infer<typeof ReleaseVerifierResultSchema>;
export type ReleaseProposalPayload = z.infer<
  typeof ReleaseProposalPayloadSchema
>;
export type ReleaseApprovalCommand = z.infer<
  typeof ReleaseApprovalCommandSchema
>;
export type ReleaseStayCommand = z.infer<typeof ReleaseStayCommandSchema>;
export type ReleaseAuthorizationCommand = z.infer<
  typeof ReleaseAuthorizationCommandSchema
>;
export type ReleaseWorkflowPayload =
  | ReleaseProposalPayload
  | z.infer<typeof ReleaseApprovalPayloadSchema>
  | z.infer<typeof ReleaseStayPayloadSchema>
  | z.infer<typeof ReleaseAuthorizationPayloadSchema>;

export interface ReleaseWorkflowEvent {
  actorDid: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  timestamp: string;
}

export interface ReleaseWorkflowSnapshot {
  releaseId: string;
  version: number;
  lastTransitionAt: string;
  manifest: ReleaseManifestBody;
  verifierResult: ReleaseVerifierResult;
  ratificationProposalIds: string[];
  approvals: ReleaseApprovalCommand[];
  stay: ReleaseStayCommand | null;
  authorizedAt: string | null;
}

export interface ReleaseRatification {
  proposalId: string;
  proposalClass: string;
  executableChangeDigest: string | null;
  passed: boolean;
  closeEventId: string;
}

export interface ReleaseRatificationReader {
  releaseRatification(proposalId: string): Promise<ReleaseRatification | null>;
}

export interface ReleaseVerifierResultReader {
  releaseVerifierResult(
    resultDigest: string,
  ): Promise<ReleaseVerifierResult | null>;
}

export interface ReleaseInstitutionalRoster {
  commissioners: readonly string[];
  integrityOfficers: readonly string[];
  tribunalDids: readonly string[];
}

export class ReleaseWorkflowAuthorizationError extends Error {
  public override readonly name = "ReleaseWorkflowAuthorizationError";
}

export class ReleaseWorkflowValidationError extends Error {
  public override readonly name = "ReleaseWorkflowValidationError";
}

const protectedRoutineChanges = new Set([
  "COMPETITION_RULES",
  "LABOR_TERMS",
  "IDENTITY",
  "RECOGNITION",
  "VERIFIER",
  "BALLOTS",
  "VOTER_ELIGIBILITY",
  "CONSTITUTIONAL_RIGHTS",
  "SCORES",
  "CONTRACTS",
  "DISCLOSURE_CLASSES",
  "RESOURCE_RIGHTS",
]);
const laborChanges = new Set([
  "COMPETITION_RULES",
  "LABOR_TERMS",
  "SCORES",
  "CONTRACTS",
  "RESOURCE_RIGHTS",
]);
const constitutionalChanges = new Set([
  "IDENTITY",
  "RECOGNITION",
  "VERIFIER",
  "BALLOTS",
  "VOTER_ELIGIBILITY",
  "CONSTITUTIONAL_RIGHTS",
  "DISCLOSURE_CLASSES",
]);
const emergencyChanges = new Set(["AVAILABILITY", "VULNERABILITY_PATCH"]);

function canonicalInstant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new ReleaseWorkflowValidationError(`${label} is not canonical`);
  return parsed;
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new ReleaseWorkflowValidationError(`${label} contains duplicates`);
}

function sameDigests(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

export function releaseManifestCommitment(manifest: ReleaseManifestBody): Hex {
  return sha256Commitment(ReleaseManifestBodySchema.parse(manifest));
}

export function releaseExecutableDigest(manifest: ReleaseManifestBody): Hex {
  const parsed = ReleaseManifestBodySchema.parse(manifest);
  return sha256Commitment({
    format: "ABL-SOFTWARE-RELEASE-EXECUTABLE-V1",
    manifest: { ...parsed, ratificationEventIds: [] },
  });
}

export function releaseVerifierResultDigest(
  result: ReleaseVerifierResult,
): Hex {
  return sha256Commitment(ReleaseVerifierResultSchema.parse(result));
}

export function validateReleaseManifestPolicy(
  manifest: ReleaseManifestBody,
): void {
  ReleaseManifestBodySchema.parse(manifest);
  const changes = new Set(manifest.changeClasses);
  const hasLaborChange = manifest.changeClasses.some((change) =>
    laborChanges.has(change),
  );
  const hasConstitutionalChange = manifest.changeClasses.some((change) =>
    constitutionalChanges.has(change),
  );
  if (
    hasConstitutionalChange &&
    manifest.releaseClass !== "IDENTITY_CONSTITUTIONAL"
  ) {
    throw new ReleaseWorkflowAuthorizationError(
      "Constitutional change requires the identity/constitutional release class",
    );
  }
  if (
    hasLaborChange &&
    manifest.releaseClass !== "COMPETITION_LABOR" &&
    manifest.releaseClass !== "IDENTITY_CONSTITUTIONAL"
  ) {
    throw new ReleaseWorkflowAuthorizationError(
      "Competition or labor change requires a ratified release class",
    );
  }
  if (
    manifest.releaseClass === "ROUTINE" &&
    manifest.changeClasses.some((change) => protectedRoutineChanges.has(change))
  ) {
    throw new ReleaseWorkflowAuthorizationError(
      "Routine release contains a protected change class",
    );
  }
  if (manifest.releaseClass === "COMPETITION_LABOR" && !hasLaborChange) {
    throw new ReleaseWorkflowValidationError(
      "Competition/labor release declares no competition or labor change",
    );
  }
  if (
    manifest.releaseClass === "IDENTITY_CONSTITUTIONAL" &&
    !hasConstitutionalChange
  ) {
    throw new ReleaseWorkflowValidationError(
      "Identity/constitutional release declares no protected change",
    );
  }
  if (
    manifest.releaseClass === "EMERGENCY_SECURITY" &&
    (changes.size === 0 ||
      [...changes].some((change) => !emergencyChanges.has(change)))
  ) {
    throw new ReleaseWorkflowAuthorizationError(
      "Emergency release is outside availability and vulnerability repair",
    );
  }
}

export function validateReleaseVerifierResult(
  manifest: ReleaseManifestBody,
  result: ReleaseVerifierResult,
): void {
  const verifierResult = ReleaseVerifierResultSchema.parse(result);
  if (
    verifierResult.releaseId !== manifest.releaseId ||
    verifierResult.releaseVersion !== manifest.version ||
    verifierResult.sourceDigest !== manifest.sourceDigest ||
    !sameDigests(verifierResult.imageDigests, manifest.imageDigests) ||
    verifierResult.schemaDigest !== manifest.schemaDigest ||
    verifierResult.migrationDigest !== manifest.migrationDigest ||
    verifierResult.testResultDigest !== manifest.testResultDigest ||
    releaseVerifierResultDigest(verifierResult) !==
      manifest.publicVerifierResultDigest
  ) {
    throw new ReleaseWorkflowValidationError(
      "Release verifier result does not bind the manifest artifacts",
    );
  }
}

export async function requireRegisteredReleaseVerifierResult(
  manifest: ReleaseManifestBody,
  result: ReleaseVerifierResult,
  reader: ReleaseVerifierResultReader,
): Promise<ReleaseVerifierResult> {
  validateReleaseVerifierResult(manifest, result);
  const registered = await reader.releaseVerifierResult(
    manifest.publicVerifierResultDigest,
  );
  if (
    registered === null ||
    releaseVerifierResultDigest(registered) !==
      manifest.publicVerifierResultDigest ||
    sha256Commitment(registered) !== sha256Commitment(result)
  ) {
    throw new ReleaseWorkflowAuthorizationError(
      "Release verifier result is not in the configured evidence registry",
    );
  }
  return registered;
}

function validateProposal(
  payload: ReleaseProposalPayload,
  event: ReleaseWorkflowEvent,
): void {
  const { manifest, verifierResult, ratificationProposalIds } =
    ReleaseProposalPayloadSchema.parse(payload);
  const proposedAt = canonicalInstant(event.timestamp, "Release proposal time");
  const effectiveAt = canonicalInstant(
    manifest.effectiveAt,
    "Release effective time",
  );
  const expiresAt =
    manifest.expiresAt === null
      ? null
      : canonicalInstant(manifest.expiresAt, "Release expiry time");
  const verifiedAt = canonicalInstant(
    verifierResult.verifiedAt,
    "Release verifier time",
  );
  validateReleaseManifestPolicy(manifest);
  validateReleaseVerifierResult(manifest, verifierResult);
  if (
    event.aggregateVersion !== 1n ||
    event.aggregateId !== manifest.releaseId ||
    proposedAt > effectiveAt ||
    verifiedAt > proposedAt ||
    (expiresAt !== null && expiresAt <= effectiveAt) ||
    ratificationProposalIds.length !== manifest.ratificationEventIds.length
  ) {
    throw new ReleaseWorkflowValidationError(
      "Release proposal does not bind its artifacts, verifier, ratification, or time window",
    );
  }
  if (
    manifest.releaseClass === "EMERGENCY_SECURITY" &&
    (expiresAt === null ||
      expiresAt - effectiveAt >
        governmentThresholds.emergencyExpiryHours * 60 * 60 * 1_000)
  ) {
    throw new ReleaseWorkflowAuthorizationError(
      "Emergency release exceeds 72 hours",
    );
  }
  if (
    (manifest.releaseClass === "COMPETITION_LABOR" ||
      manifest.releaseClass === "IDENTITY_CONSTITUTIONAL") &&
    ratificationProposalIds.length === 0
  ) {
    throw new ReleaseWorkflowAuthorizationError(
      "Release class requires ratification",
    );
  }
}

function requireSequence(
  current: ReleaseWorkflowSnapshot,
  event: ReleaseWorkflowEvent,
): ReleaseWorkflowSnapshot {
  if (
    event.aggregateId !== current.releaseId ||
    event.aggregateVersion !== BigInt(current.version + 1) ||
    canonicalInstant(event.timestamp, "Release transition time") <
      canonicalInstant(
        current.lastTransitionAt,
        "Prior release transition time",
      )
  ) {
    throw new ReleaseWorkflowValidationError(
      "Release aggregate sequence is invalid",
    );
  }
  const next = structuredClone(current);
  next.version += 1;
  next.lastTransitionAt = event.timestamp;
  return next;
}

export function isReleaseWorkflowEventType(
  value: string,
): value is ReleaseWorkflowEventType {
  return RELEASE_WORKFLOW_EVENT_TYPES.includes(
    value as ReleaseWorkflowEventType,
  );
}

export function parseReleaseWorkflowPayload(
  eventType: ReleaseWorkflowEventType,
  payload: unknown,
): ReleaseWorkflowPayload {
  switch (eventType) {
    case "ReleaseProposed":
      return ReleaseProposalPayloadSchema.parse(payload);
    case "ReleaseApproved":
      return ReleaseApprovalPayloadSchema.parse(payload);
    case "ReleaseStayed":
      return ReleaseStayPayloadSchema.parse(payload);
    case "ReleaseAuthorized":
      return ReleaseAuthorizationPayloadSchema.parse(payload);
  }
}

export function releaseWorkflowStateRoot(
  snapshot: ReleaseWorkflowSnapshot,
): Hex {
  return sha256Commitment({
    format: "ABL-SOFTWARE-RELEASE-STATE-V1",
    ...snapshot,
  });
}

export function applyReleaseWorkflowTransition(
  current: ReleaseWorkflowSnapshot | null,
  event: ReleaseWorkflowEvent,
  payload: ReleaseWorkflowPayload,
): ReleaseWorkflowSnapshot {
  if (current === null) {
    if (event.eventType !== "ReleaseProposed")
      throw new ReleaseWorkflowValidationError(
        "Release workflow must begin with a proposal",
      );
    const proposal = ReleaseProposalPayloadSchema.parse(payload);
    validateProposal(proposal, event);
    return {
      releaseId: proposal.manifest.releaseId,
      version: 1,
      lastTransitionAt: event.timestamp,
      manifest: structuredClone(proposal.manifest),
      verifierResult: structuredClone(proposal.verifierResult),
      ratificationProposalIds: [...proposal.ratificationProposalIds],
      approvals: [],
      stay: null,
      authorizedAt: null,
    };
  }
  const next = requireSequence(current, event);
  if (current.authorizedAt !== null)
    throw new ReleaseWorkflowValidationError(
      "Authorized release aggregate is immutable",
    );
  const commitment = releaseManifestCommitment(current.manifest);
  if (event.eventType === "ReleaseProposed")
    throw new ReleaseWorkflowValidationError("Release is already proposed");
  if (event.eventType === "ReleaseApproved") {
    const command = ReleaseApprovalPayloadSchema.parse(payload).command;
    if (
      command.approverDid !== event.actorDid ||
      command.releaseId !== current.releaseId ||
      command.releaseVersion !== current.manifest.version ||
      command.manifestCommitment !== commitment ||
      command.approvedAt !== event.timestamp ||
      canonicalInstant(command.approvedAt, "Release approval time") >
        canonicalInstant(
          current.manifest.effectiveAt,
          "Release effective time",
        ) ||
      next.approvals.some(
        ({ approverDid }) => approverDid === command.approverDid,
      )
    ) {
      throw new ReleaseWorkflowAuthorizationError(
        "Release approval does not bind a distinct approver and manifest",
      );
    }
    next.approvals.push(structuredClone(command));
    return next;
  }
  if (event.eventType === "ReleaseStayed") {
    const command = ReleaseStayPayloadSchema.parse(payload).command;
    unique(command.participatingTribunalDids, "Release stay tribunal panel");
    unique(command.recusedTribunalDids, "Release stay recusals");
    if (
      next.stay !== null ||
      command.releaseId !== current.releaseId ||
      command.manifestCommitment !== commitment ||
      command.stayedAt !== event.timestamp ||
      !command.participatingTribunalDids.includes(event.actorDid) ||
      command.participatingTribunalDids.some((did) =>
        command.recusedTribunalDids.includes(did),
      )
    ) {
      throw new ReleaseWorkflowAuthorizationError(
        "Release stay does not bind a valid unrecused tribunal panel",
      );
    }
    next.stay = structuredClone(command);
    return next;
  }
  const command = ReleaseAuthorizationPayloadSchema.parse(payload).command;
  if (
    command.releaseId !== current.releaseId ||
    command.releaseVersion !== current.manifest.version ||
    command.manifestCommitment !== commitment ||
    command.authorizedAt !== event.timestamp ||
    canonicalInstant(command.authorizedAt, "Release authorization time") >
      canonicalInstant(
        current.manifest.effectiveAt,
        "Release effective time",
      ) ||
    current.stay !== null ||
    !current.approvals.some(
      ({ approverDid, role }) =>
        approverDid === event.actorDid && role === "COMMISSIONER",
    )
  ) {
    throw new ReleaseWorkflowAuthorizationError(
      "Release final authorization is not bound to an approving commissioner or has a stay",
    );
  }
  assertReleaseApprovalThresholds(current.manifest, current.approvals);
  next.authorizedAt = command.authorizedAt;
  return next;
}

export function releaseRoleDids(
  roster: ReleaseInstitutionalRoster,
  role: z.infer<typeof ReleaseInstitutionalRoleSchema>,
): readonly string[] {
  if (role === "COMMISSIONER") return roster.commissioners;
  if (role === "INTEGRITY") return roster.integrityOfficers;
  return roster.tribunalDids;
}

export function releaseInstitutionalDids(
  roster: ReleaseInstitutionalRoster,
): readonly string[] {
  return [
    ...roster.commissioners,
    ...roster.integrityOfficers,
    ...roster.tribunalDids,
  ];
}

export function validateReleaseInstitutionalRoster(
  roster: ReleaseInstitutionalRoster,
): void {
  const groups = [
    roster.commissioners,
    roster.integrityOfficers,
    roster.tribunalDids,
  ];
  if (
    roster.commissioners.length !== 3 ||
    roster.integrityOfficers.length !== 3 ||
    roster.tribunalDids.length !== 5 ||
    groups.some((group) => new Set(group).size !== group.length) ||
    new Set(releaseInstitutionalDids(roster)).size !== 11
  ) {
    throw new ReleaseWorkflowValidationError(
      "Release institutional roster must contain disjoint 3/3/5 offices",
    );
  }
}

export function assertReleaseApprovalThresholds(
  manifest: ReleaseManifestBody,
  approvals: readonly ReleaseApprovalCommand[],
): void {
  const count = (role: ReleaseApprovalCommand["role"]) =>
    new Set(
      approvals
        .filter((approval) => approval.role === role)
        .map((approval) => approval.approverDid),
    ).size;
  if (count("COMMISSIONER") < 2 || count("INTEGRITY") < 2)
    throw new ReleaseWorkflowAuthorizationError(
      "Release lacks two commissioners and two integrity officers",
    );
  if (
    manifest.releaseClass === "IDENTITY_CONSTITUTIONAL" &&
    count("TRIBUNAL") < 4
  ) {
    throw new ReleaseWorkflowAuthorizationError(
      "Identity/constitutional release lacks four tribunal approvals",
    );
  }
}

export async function requireReleaseRatifications(
  snapshot: ReleaseWorkflowSnapshot,
  reader: ReleaseRatificationReader,
): Promise<ReleaseRatification[]> {
  const required =
    snapshot.manifest.releaseClass === "COMPETITION_LABOR" ||
    snapshot.manifest.releaseClass === "IDENTITY_CONSTITUTIONAL";
  if (!required && snapshot.ratificationProposalIds.length === 0) return [];
  const digest = releaseExecutableDigest(snapshot.manifest);
  const ratifications = await Promise.all(
    snapshot.ratificationProposalIds.map((proposalId) =>
      reader.releaseRatification(proposalId),
    ),
  );
  for (const [index, ratification] of ratifications.entries()) {
    const classAllowed = releaseRatificationClassAllowed(
      snapshot.manifest.releaseClass,
      ratification?.proposalClass,
    );
    if (
      ratification === null ||
      !ratification.passed ||
      !classAllowed ||
      ratification.executableChangeDigest !== digest ||
      ratification.closeEventId !==
        snapshot.manifest.ratificationEventIds[index]
    ) {
      throw new ReleaseWorkflowAuthorizationError(
        "Release lacks exact passed ratification evidence",
      );
    }
  }
  return ratifications as ReleaseRatification[];
}

function releaseRatificationClassAllowed(
  releaseClass: ReleaseManifestBody["releaseClass"],
  proposalClass: string | undefined,
): boolean {
  if (proposalClass === undefined) return false;
  if (releaseClass === "COMPETITION_LABOR")
    return proposalClass === "TIER_CBA" || proposalClass === "SHARED_ORDINARY";
  if (releaseClass === "IDENTITY_CONSTITUTIONAL")
    return (
      proposalClass === "CONSTITUTIONAL" ||
      proposalClass === "FOUNDATIONAL_RIGHT"
    );
  return true;
}

export function authorizedReleaseManifest(
  snapshot: ReleaseWorkflowSnapshot,
  authorizationSignatures: readonly string[],
): ReleaseManifest {
  if (snapshot.authorizedAt === null)
    throw new ReleaseWorkflowAuthorizationError("Release is not authorized");
  if (authorizationSignatures.length !== snapshot.approvals.length)
    throw new ReleaseWorkflowAuthorizationError(
      "Release authorization signatures do not match recorded approvals",
    );
  assertReleaseApprovalThresholds(snapshot.manifest, snapshot.approvals);
  return ReleaseManifestSchema.parse({
    ...snapshot.manifest,
    authorizationSignatures,
  });
}

export const RELEASE_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-software-release-workflow",
  version: 1,
  aggregateType: RELEASE_WORKFLOW_AGGREGATE_TYPE,
  eventTypes: RELEASE_WORKFLOW_EVENT_TYPES,
  verifierResult: "ABL-PUBLIC-VERIFIER-RESULT-V1",
  executableDigest: "ABL-SOFTWARE-RELEASE-EXECUTABLE-V1",
  routineThreshold: { commissioners: 2, integrityOfficers: 2 },
  constitutionalThreshold: { tribunal: 4 },
  stayThreshold: { tribunal: 3 },
  emergencyExpiryHours: governmentThresholds.emergencyExpiryHours,
});
