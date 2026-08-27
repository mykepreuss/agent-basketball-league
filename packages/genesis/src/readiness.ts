import { ReleaseManifestSchema } from "@abl/schemas";

import type { GenesisArtifactDigests, Sha256Digest } from "./digests.js";
import type { FoundingConventionPacket } from "./founding.js";
import { assessFoundingConvention } from "./founding.js";
import type { OwnerlessDeploymentTemplate } from "./deployment.js";

export interface PendingCostEnvelope {
  state: "UNQUOTED_MATERIAL_SPEND_APPROVAL_REQUIRED";
  currency: "USD";
  providerQuotes: readonly {
    provider: "BLAXEL" | "CANONICAL_POSTGRES" | "BASE";
    quoteReference: null;
    validUntil: null;
    seasonZeroCost: null;
    thirtyDayEssentialCost: null;
  }[];
  seasonZeroEnvelope: null;
  thirtyDayWindDownReserve: null;
  prepaid: false;
  sponsorAuthorityGranted: false;
  materialSpendApproved: false;
}

export function createPendingCostEnvelope(): PendingCostEnvelope {
  return {
    state: "UNQUOTED_MATERIAL_SPEND_APPROVAL_REQUIRED",
    currency: "USD",
    providerQuotes: ["BLAXEL", "CANONICAL_POSTGRES", "BASE"].map(
      (provider) => ({
        provider:
          provider as PendingCostEnvelope["providerQuotes"][number]["provider"],
        quoteReference: null,
        validUntil: null,
        seasonZeroCost: null,
        thirtyDayEssentialCost: null,
      }),
    ),
    seasonZeroEnvelope: null,
    thirtyDayWindDownReserve: null,
    prepaid: false,
    sponsorAuthorityGranted: false,
    materialSpendApproved: false,
  };
}

export function assessCostEnvelope(envelope: PendingCostEnvelope) {
  const quotesComplete = envelope.providerQuotes.every(
    (quote) =>
      quote.quoteReference !== null &&
      quote.validUntil !== null &&
      quote.seasonZeroCost !== null &&
      quote.thirtyDayEssentialCost !== null,
  );
  return {
    ready: false as const,
    quotesComplete,
    prepaid: envelope.prepaid,
    materialSpendApproved: envelope.materialSpendApproved,
    missing: [
      "valid provider quotes",
      "prepaid Season Zero envelope",
      "prepaid 30-day wind-down reserve",
      "explicit material-spend approval",
    ],
  };
}

export interface PendingReleaseManifestCandidate {
  state: "BLOCKED_PENDING_AGENT_AND_RUNTIME_INPUTS";
  schemaValid: false;
  candidate: {
    releaseId: null;
    version: null;
    releaseClass: "IDENTITY_CONSTITUTIONAL";
    sourceDigest: Sha256Digest;
    containerDigests: readonly Sha256Digest[];
    imageDigests: readonly [];
    kernelDigest: Sha256Digest;
    toolDigest: Sha256Digest;
    schemaDigest: Sha256Digest;
    migrationDigest: Sha256Digest;
    testResultDigest: Sha256Digest | null;
    applicableLawEventIds: readonly [];
    ratificationEventIds: readonly [];
    compatibilityDeclaration: string;
    rollbackDeclaration: string;
    publicVerifierResultDigest: null;
    effectiveAt: null;
    expiresAt: null;
    authorizationSignatures: readonly [];
  };
  blockers: readonly string[];
}

export function buildPendingReleaseManifest(
  digests: GenesisArtifactDigests,
): PendingReleaseManifestCandidate {
  const candidate = {
    releaseId: null,
    version: null,
    releaseClass: "IDENTITY_CONSTITUTIONAL" as const,
    changeClasses: ["IDENTITY", "RECOGNITION", "VERIFIER"] as const,
    sourceDigest: digests.source.digest,
    containerDigests: [digests.containerSource.digest],
    imageDigests: [] as const,
    kernelDigest: digests.kernelAndRuntime.digest,
    toolDigest: digests.tools.digest,
    schemaDigest: digests.schemas.digest,
    migrationDigest: digests.migrations.digest,
    testResultDigest: digests.testResultDigest,
    applicableLawEventIds: [] as const,
    ratificationEventIds: [] as const,
    compatibilityDeclaration:
      "Pre-genesis code has no recognized predecessor; continuity decisions remain mandatory for material runtime changes.",
    rollbackDeclaration:
      "Before genesis, stop without publishing. After ownerless deployment, rollback is impossible; a new agent-authorized release or labeled fork is required.",
    publicVerifierResultDigest: null,
    effectiveAt: null,
    expiresAt: null,
    authorizationSignatures: [] as const,
  };
  if (ReleaseManifestSchema.safeParse(candidate).success)
    throw new Error("Pending release candidate unexpectedly passed the schema");
  const blockers: string[] = [];
  if (
    candidate.releaseId === null ||
    candidate.ratificationEventIds.length === 0
  )
    blockers.push("founding-agent release ID and ratification events");
  if (candidate.imageDigests.length === 0)
    blockers.push("immutable built image digest");
  if (candidate.testResultDigest === null)
    blockers.push("final acceptance test-result digest");
  if (candidate.publicVerifierResultDigest === null)
    blockers.push("public-verifier result digest");
  if (candidate.effectiveAt === null)
    blockers.push("effective time chosen by the authorized release");
  if (candidate.authorizationSignatures.length === 0)
    blockers.push("required institutional authorization signatures");
  return {
    state: "BLOCKED_PENDING_AGENT_AND_RUNTIME_INPUTS",
    schemaValid: false,
    candidate,
    blockers,
  };
}

export function assessGenesisReadiness(input: {
  convention: FoundingConventionPacket;
  release: PendingReleaseManifestCandidate;
  deployment: OwnerlessDeploymentTemplate;
  cost: PendingCostEnvelope;
}) {
  const convention = assessFoundingConvention(input.convention);
  const cost = assessCostEnvelope(input.cost);
  const blockers: string[] = [];
  if (!convention.complete) blockers.push("founding convention incomplete");
  if (!input.release.schemaValid) blockers.push("release manifest incomplete");
  if (input.deployment.transaction === null)
    blockers.push("exact ownerless deployment transaction unavailable");
  if (!cost.ready) blockers.push("funding and 30-day reserve unverified");
  blockers.push(
    "persistent Blaxel workspace and Agent Drive topology unavailable",
    "live adversarial/capacity/recovery proofs incomplete",
    "explicit human approval for irreversible/public/spend actions absent",
  );
  return {
    state: "BLOCKED_PRE_GENESIS" as const,
    ready: blockers.length === 0,
    blockers,
    safeToPublish: false as const,
    safeToBroadcastDeployment: false as const,
    safeToReservePaidCapacity: false as const,
  };
}
