import {
  checkpointManifestDigest,
  createCheckpointManifest,
  verifyCheckpointClaim,
  type CheckpointChainClaim,
  type CheckpointChainObservation,
  type CheckpointManifest,
  type CheckpointRecognitionAnchor,
  type VerificationLabel,
} from "@abl/recognition";
import {
  CheckpointManifestSchema,
  RecognitionCheckpointSchema,
} from "@abl/schemas";
import type { Address, Hex } from "viem";
import { z } from "zod";

export const CheckpointPublicationSchema = z
  .strictObject({
    manifest: CheckpointManifestSchema,
    checkpoint: RecognitionCheckpointSchema,
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

export interface PublicCheckpointProjection {
  state: "REHEARSAL";
  canonical: boolean;
  recognized: boolean;
  verification: VerificationLabel;
  reasons: readonly string[];
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

function chainClaim(publication: CheckpointPublication): CheckpointChainClaim {
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

export class PublicCheckpointProjectionRepository
  implements PublicCheckpointProjectionReader
{
  readonly #publications: readonly CheckpointPublication[];
  readonly #checkpointObservation: CheckpointObservationReader["checkpointObservation"];
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
        const claim = chainClaim(publication);
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
        projections.push({
          state: "REHEARSAL",
          canonical: verification.label === "CANONICAL",
          recognized: verification.label === "CANONICAL",
          verification: verification.label,
          reasons: [...verification.reasons],
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
          evaluatedAt: canonicalInstant(
            this.#now().toISOString(),
            "Checkpoint evaluation time",
          ),
        });
      }
      this.#projections.splice(0, this.#projections.length, ...projections);
    });
  }

  public checkpoints(): readonly PublicCheckpointProjection[] {
    return structuredClone(this.#projections);
  }
}
