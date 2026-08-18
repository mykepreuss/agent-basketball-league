import {
  checkpointManifestDigest,
  createCheckpointManifest,
  verifyCheckpointClaim,
  verifyCheckpointWitnesses,
  type CheckpointAuthorizationResult,
  type CheckpointChainClaim,
  type CheckpointChainObservation,
  type CheckpointManifest,
  type CheckpointRecognitionLevel,
  type CheckpointRecognitionAnchor,
  type CheckpointWitnessRecord,
  type CheckpointWitnessResult,
  type VerificationLabel,
} from "@abl/recognition";
import {
  CheckpointWitnessAttestationSchema,
  CheckpointManifestSchema,
  RecognitionCheckpointSchema,
} from "@abl/schemas";
import type { Address, Hex } from "viem";
import { z } from "zod";

export const CheckpointPublicationSchema = z
  .strictObject({
    manifest: CheckpointManifestSchema,
    checkpoint: RecognitionCheckpointSchema,
    witnesses: z.array(CheckpointWitnessAttestationSchema).max(16).optional(),
  })
  .superRefine(({ checkpoint }, context) => {
    if (
      checkpoint.transactionHash === null &&
      checkpoint.blockNumber !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Checkpoint block number requires a transaction hash",
        path: ["checkpoint", "transactionHash"],
      });
    }
  });

export type CheckpointPublication = z.infer<typeof CheckpointPublicationSchema>;

export interface CheckpointObservationReader {
  checkpointObservation(
    publication: CheckpointPublication,
  ): Promise<CheckpointChainObservation | null>;
}

export interface CheckpointAuthorizationReader {
  checkpointAuthorization(
    publication: CheckpointPublication,
  ): Promise<CheckpointAuthorizationResult>;
}

export interface PublicCheckpointProjection {
  state: "REHEARSAL";
  canonical: boolean;
  recognized: boolean;
  recognitionLevel: CheckpointRecognitionLevel;
  verification: VerificationLabel;
  reasons: readonly string[];
  authorizationVerified: boolean;
  authorizationReasons: readonly string[];
  authorizedSigners: readonly Address[];
  witnessVerification: CheckpointWitnessResult["status"];
  witnessReasons: readonly string[];
  verifiedWitnessIds: readonly string[];
  verifiedWitnessAdministrativeDomains: readonly string[];
  minimumWitnesses: number;
  manifest: CheckpointManifest;
  checkpoint: CheckpointPublication["checkpoint"];
  confirmations: number | null;
  observedBlockNumber: string | null;
  recognitionAnchorState: CheckpointRecognitionAnchor["state"];
  requiredConfirmations: number;
  observedAt: string | null;
  evaluatedAt: string;
}

export interface PublicCheckpointProjectionReader {
  refresh(): Promise<void>;
  checkpoints(): readonly PublicCheckpointProjection[];
}

export interface PublicCheckpointProjectionRepositoryOptions
  extends CheckpointObservationReader {
  publications: readonly unknown[];
  anchor: CheckpointRecognitionAnchor;
  checkpointAuthorization?: CheckpointAuthorizationReader["checkpointAuthorization"];
  witnessRegistry?: readonly CheckpointWitnessRecord[];
  minimumWitnesses?: number;
  now?: () => Date;
}

function canonicalInstant(value: string, label: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  ) {
    throw new Error(`${label} is not canonical`);
  }
  return value;
}

function manifestFromPublication(
  publication: CheckpointPublication,
): CheckpointManifest {
  const { manifest } = publication;
  const recomputed = createCheckpointManifest({
    manifestId: manifest.manifestId,
    checkpointType: manifest.checkpointType,
    subjectId: manifest.subjectId,
    eventHashes: manifest.eventHashes as readonly Hex[],
    institutionalKeyRegistryDigest:
      manifest.institutionalKeyRegistryDigest as Hex,
    verifierDigest: manifest.verifierDigest as Hex,
    previousManifestDigest: manifest.previousManifestDigest as Hex | null,
    createdAt: canonicalInstant(manifest.createdAt, "Checkpoint creation time"),
  });
  if (
    recomputed.merkleRoot !== manifest.merkleRoot ||
    recomputed.firstEventHash !== manifest.firstEventHash ||
    recomputed.lastEventHash !== manifest.lastEventHash
  ) {
    throw new Error("Checkpoint manifest does not match its event hashes");
  }
  return recomputed;
}

export function checkpointChainClaim(
  publication: CheckpointPublication,
): CheckpointChainClaim {
  const { checkpoint } = publication;
  return {
    checkpointType: checkpoint.checkpointType,
    subjectId: checkpoint.subjectId,
    root: checkpoint.root as Hex,
    previousRoot: checkpoint.previousRoot as Hex,
    nonce: checkpoint.nonce as Hex,
    validAfter: BigInt(checkpoint.validAfter),
    validBefore: BigInt(checkpoint.validBefore),
    chainId: checkpoint.chainId,
    contractAddress: checkpoint.contractAddress as Address,
    transactionHash: checkpoint.transactionHash as Hex | null,
    blockNumber:
      checkpoint.blockNumber === null ? null : BigInt(checkpoint.blockNumber),
    signatures: checkpoint.signatures as readonly Hex[],
  };
}

function recognitionLevelForCheckpoint(input: {
  verification: VerificationLabel;
  authorizationValid: boolean;
  witnessesVerified: boolean;
}): CheckpointRecognitionLevel {
  if (input.verification === "CANONICAL") return "ONCHAIN_FINALIZED";
  if (!input.authorizationValid) return "NONE";
  if (input.witnessesVerified) return "INDEPENDENTLY_WITNESSED";
  return "SIGNED_VALID";
}

export class PublicCheckpointProjectionRepository
  implements PublicCheckpointProjectionReader
{
  readonly #publications: readonly CheckpointPublication[];
  readonly #checkpointObservation: CheckpointObservationReader["checkpointObservation"];
  readonly #checkpointAuthorization: CheckpointAuthorizationReader["checkpointAuthorization"];
  readonly #witnessRegistry: readonly CheckpointWitnessRecord[];
  readonly #minimumWitnesses: number;
  readonly #anchor: CheckpointRecognitionAnchor;
  readonly #now: () => Date;
  readonly #projections: PublicCheckpointProjection[] = [];
  #operationTail = Promise.resolve();

  public constructor(options: PublicCheckpointProjectionRepositoryOptions) {
    this.#publications = options.publications.map((publication) =>
      CheckpointPublicationSchema.parse(publication),
    );
    if (
      !Number.isSafeInteger(options.anchor.requiredConfirmations) ||
      options.anchor.requiredConfirmations <= 0
    ) {
      throw new Error("Checkpoint finality threshold is invalid");
    }
    this.#checkpointObservation = options.checkpointObservation;
    this.#checkpointAuthorization =
      options.checkpointAuthorization ??
      (async () => ({
        valid: false,
        reasons: ["CHECKPOINT_AUTHORIZATION_VERIFIER_NOT_CONFIGURED"],
        signers: [],
      }));
    this.#witnessRegistry = structuredClone(options.witnessRegistry ?? []);
    this.#minimumWitnesses = options.minimumWitnesses ?? 2;
    this.#anchor = structuredClone(options.anchor);
    this.#now = options.now ?? (() => new Date());
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.#operationTail;
    let release!: () => void;
    this.#operationTail = new Promise<void>((resolveOperation) => {
      release = resolveOperation;
    });
    await prior;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  public async initialize(): Promise<void> {
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const projections: PublicCheckpointProjection[] = [];
      for (const publication of this.#publications) {
        const manifest = manifestFromPublication(publication);
        const claim = checkpointChainClaim(publication);
        if (
          publication.checkpoint.manifestDigest !==
            checkpointManifestDigest(manifest) ||
          publication.checkpoint.checkpointType !== manifest.checkpointType ||
          publication.checkpoint.subjectId !== manifest.subjectId ||
          (publication.checkpoint.checkpointType !== "KEY_REGISTRY" &&
            publication.checkpoint.root !== manifest.merkleRoot)
        ) {
          throw new Error("Checkpoint publication does not bind its manifest");
        }
        let observation: CheckpointChainObservation | null = null;
        let readFailed = false;
        if (
          this.#anchor.state === "RATIFIED" &&
          claim.transactionHash !== null
        ) {
          try {
            observation = await this.#checkpointObservation(publication);
          } catch {
            readFailed = true;
          }
        }
        const verification = readFailed
          ? {
              label: "UNVERIFIABLE" as const,
              reasons: ["CHECKPOINT_CHAIN_READ_FAILED"],
            }
          : verifyCheckpointClaim({
              manifest,
              manifestDigest: publication.checkpoint.manifestDigest as Hex,
              claim,
              observation,
              anchor: this.#anchor,
            });
        let authorization: CheckpointAuthorizationResult;
        try {
          authorization = await this.#checkpointAuthorization(publication);
        } catch {
          authorization = {
            valid: false,
            reasons: ["CHECKPOINT_AUTHORIZATION_READ_FAILED"],
            signers: [],
          };
        }
        const evaluatedAt = canonicalInstant(
          this.#now().toISOString(),
          "Checkpoint evaluation time",
        );
        const witnessVerification = await verifyCheckpointWitnesses({
          manifestDigest: publication.checkpoint.manifestDigest as Hex,
          root: publication.checkpoint.root as Hex,
          attestations: (publication.witnesses ?? []).map((attestation) => ({
            ...attestation,
            manifestDigest: attestation.manifestDigest as Hex,
            root: attestation.root as Hex,
            signature: attestation.signature as Hex,
          })),
          registry: this.#witnessRegistry,
          minimumWitnesses: this.#minimumWitnesses,
          notBefore: manifest.createdAt,
          evaluatedAt,
        });
        const recognitionLevel = recognitionLevelForCheckpoint({
          verification: verification.label,
          authorizationValid: authorization.valid,
          witnessesVerified: witnessVerification.status === "VERIFIED",
        });
        projections.push({
          state: "REHEARSAL",
          canonical: verification.label === "CANONICAL",
          recognized: verification.label === "CANONICAL",
          recognitionLevel,
          verification: verification.label,
          reasons: [...verification.reasons],
          authorizationVerified:
            authorization.valid || verification.label === "CANONICAL",
          authorizationReasons: [...authorization.reasons],
          authorizedSigners: [...authorization.signers],
          witnessVerification: witnessVerification.status,
          witnessReasons: [...witnessVerification.reasons],
          verifiedWitnessIds: [...witnessVerification.verifiedWitnessIds],
          verifiedWitnessAdministrativeDomains: [
            ...witnessVerification.verifiedAdministrativeDomains,
          ],
          minimumWitnesses: this.#minimumWitnesses,
          manifest,
          checkpoint: structuredClone(publication.checkpoint),
          confirmations: observation?.confirmations ?? null,
          observedBlockNumber: observation?.blockNumber.toString() ?? null,
          recognitionAnchorState: this.#anchor.state,
          requiredConfirmations: this.#anchor.requiredConfirmations,
          observedAt:
            observation === null
              ? null
              : canonicalInstant(
                  observation.observedAt,
                  "Checkpoint observation time",
                ),
          evaluatedAt,
        });
      }
      this.#projections.splice(0, this.#projections.length, ...projections);
    });
  }

  public checkpoints(): readonly PublicCheckpointProjection[] {
    return structuredClone(this.#projections);
  }
}
