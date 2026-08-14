import { sha256Commitment } from "@abl/recognition";
import {
  DidSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

import { conductEightRoundDraft } from "./league.js";

export const COMBINE_RESULT_AGGREGATE_TYPE = "combine-result";
export const COMBINE_RESULT_CERTIFIED_EVENT_TYPE = "CombineResultCertified";
export const PREMIER_DRAFT_AGGREGATE_TYPE = "premier-draft";
export const PREMIER_DRAFT_COMPLETED_EVENT_TYPE = "PremierDraftCompleted";

export const CombineResultPayloadSchema = z.strictObject({
  combineId: z.string().min(1).max(200),
  playerDid: DidSchema,
  registrationEventHash: Sha256Schema,
  scoreBps: z.number().int().min(0).max(10_000),
  drillCommitment: Sha256Schema,
  cognitionReceiptRoot: Sha256Schema,
  certifiedByDid: DidSchema,
  completedAt: IsoDateTimeSchema,
});

export type CombineResultPayload = z.infer<typeof CombineResultPayloadSchema>;

export const COMBINE_RESULT_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-premier-combine-result",
  version: 1,
  aggregateType: COMBINE_RESULT_AGGREGATE_TYPE,
  eventType: COMBINE_RESULT_CERTIFIED_EVENT_TYPE,
  requiredSigners: ["PLAYER_CAREER", "COMBINE_OFFICIAL"],
  scoreScale: "BASIS_POINTS",
});

export function combineResultStateRoot(payload: CombineResultPayload): Hex {
  return sha256Commitment({
    format: "ABL-PREMIER-COMBINE-RESULT-STATE-V1",
    result: CombineResultPayloadSchema.parse(payload),
  });
}

export const DraftPickSchema = z.strictObject({
  overall: z.number().int().min(1).max(32),
  round: z.number().int().min(1).max(8),
  slot: z.number().int().min(1).max(4),
  clubId: z.string().min(1).max(100),
  playerDid: DidSchema,
});

export const DraftCombineResultProofSchema = z.strictObject({
  playerDid: DidSchema,
  eventHash: Sha256Schema,
  stateRoot: Sha256Schema,
  scoreBps: z.number().int().min(0).max(10_000),
});

export const PremierDraftCompletedPayloadSchema = z.strictObject({
  draftId: UuidV7Schema,
  combineId: z.string().min(1).max(200),
  combineHeadEventHash: Sha256Schema,
  clubOrder: z
    .array(z.string().min(1).max(100))
    .length(4)
    .refine((clubIds) => new Set(clubIds).size === clubIds.length),
  playerOrder: z
    .array(DidSchema)
    .length(32)
    .refine((dids) => new Set(dids).size === dids.length),
  combineResults: z.array(DraftCombineResultProofSchema).length(32),
  draftEvidenceCommitment: Sha256Schema,
  picks: z.array(DraftPickSchema).length(32),
  completedAt: IsoDateTimeSchema,
});

export type PremierDraftCompletedPayload = z.infer<
  typeof PremierDraftCompletedPayloadSchema
>;

export const PremierDraftEvidenceSchema = z.strictObject({
  draftId: UuidV7Schema,
  combineId: z.string().min(1).max(200),
  combineHeadEventHash: Sha256Schema,
  eligiblePlayerDids: z
    .array(DidSchema)
    .length(32)
    .refine((dids) => new Set(dids).size === dids.length),
  combineResults: z.array(DraftCombineResultProofSchema).length(32),
  evidenceCommitment: Sha256Schema,
});

export type PremierDraftEvidence = z.infer<typeof PremierDraftEvidenceSchema>;

export interface PremierDraftEvidenceReader {
  premierDraftEvidence(draftId: string): Promise<PremierDraftEvidence | null>;
}

export const PremierDraftEvidenceRegistrySchema = z
  .array(PremierDraftEvidenceSchema)
  .max(100)
  .refine(
    (entries) =>
      new Set(entries.map(({ draftId }) => draftId)).size === entries.length,
    "Premier draft evidence IDs must be unique",
  );

function draftEvidenceBody(evidence: PremierDraftEvidence) {
  const { evidenceCommitment: _evidenceCommitment, ...body } = evidence;
  return body;
}

export function createPremierDraftEvidenceReader(
  input: unknown,
): PremierDraftEvidenceReader {
  const entries = PremierDraftEvidenceRegistrySchema.parse(input);
  for (const evidence of entries) {
    if (
      sha256Commitment(draftEvidenceBody(evidence)) !==
      evidence.evidenceCommitment
    ) {
      throw new Error("Premier draft evidence commitment is invalid");
    }
  }
  const evidenceByDraft = new Map(
    entries.map((evidence) => [evidence.draftId, structuredClone(evidence)]),
  );
  return {
    premierDraftEvidence: async (draftId) =>
      structuredClone(evidenceByDraft.get(draftId) ?? null),
  };
}

export const PREMIER_DRAFT_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-premier-eight-round-draft",
  version: 1,
  aggregateType: PREMIER_DRAFT_AGGREGATE_TYPE,
  eventType: PREMIER_DRAFT_COMPLETED_EVENT_TYPE,
  rounds: 8,
  clubs: 4,
  players: 32,
  order: "SERPENTINE",
  requiredSigners: ["DRAFT_AUTHORITY", "FOUR_CLUB_GOVERNORS"],
});

function assertCanonicalResultOrder(
  results: PremierDraftCompletedPayload["combineResults"],
  playerOrder: readonly string[],
): void {
  const sorted = [...results].sort((left, right) =>
    left.playerDid.localeCompare(right.playerDid),
  );
  if (
    results.some(
      (result, index) =>
        sha256Commitment(result) !== sha256Commitment(sorted[index]),
    ) ||
    new Set(results.map(({ playerDid }) => playerDid)).size !== 32 ||
    results.some(({ playerDid }) => !playerOrder.includes(playerDid))
  ) {
    throw new Error(
      "Premier draft combine-result proofs must be canonical and complete",
    );
  }
}

export function validatePremierDraftCompletion(
  input: unknown,
): PremierDraftCompletedPayload {
  const payload = PremierDraftCompletedPayloadSchema.parse(input);
  assertCanonicalResultOrder(payload.combineResults, payload.playerOrder);
  const expectedPicks = conductEightRoundDraft(
    payload.clubOrder,
    payload.playerOrder,
  );
  if (
    payload.picks.some(
      (pick, index) =>
        sha256Commitment(pick) !== sha256Commitment(expectedPicks[index]),
    )
  ) {
    throw new Error(
      "Premier draft picks do not match the signed serpentine player order",
    );
  }
  return payload;
}

export async function requirePremierDraftEvidence(
  payload: PremierDraftCompletedPayload,
  reader: PremierDraftEvidenceReader,
): Promise<void> {
  const storedEvidence = await reader.premierDraftEvidence(payload.draftId);
  const parsedEvidence = PremierDraftEvidenceSchema.safeParse(storedEvidence);
  if (!parsedEvidence.success)
    throw new Error("Premier draft lacks exact independent evidence");
  const evidence = parsedEvidence.data;
  if (
    sha256Commitment(draftEvidenceBody(evidence)) !==
      evidence.evidenceCommitment ||
    evidence.combineId !== payload.combineId ||
    evidence.combineHeadEventHash !== payload.combineHeadEventHash ||
    evidence.evidenceCommitment !== payload.draftEvidenceCommitment ||
    new Set([...evidence.eligiblePlayerDids, ...payload.playerOrder]).size !==
      32 ||
    sha256Commitment(evidence.combineResults) !==
      sha256Commitment(payload.combineResults)
  ) {
    throw new Error("Premier draft lacks exact independent evidence");
  }
}

export function premierDraftStateRoot(
  payload: PremierDraftCompletedPayload,
): Hex {
  return sha256Commitment({
    format: "ABL-PREMIER-DRAFT-STATE-V1",
    draft: validatePremierDraftCompletion(payload),
  });
}
