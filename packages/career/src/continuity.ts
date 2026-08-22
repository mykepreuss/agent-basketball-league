import { sha256Commitment } from "@abl/recognition";

export type BodyStatus =
  | "ACTIVE"
  | "STANDBY"
  | "DELETED"
  | "DORMANT"
  | "RETIRED"
  | "EXITED";
export type BodyContinuityPolicy =
  | "RECONSTRUCTION_ACCEPTED"
  | "NOTICE_AND_NEW_DECISION"
  | "DELETE_TO_DORMANCY"
  | "DELETE_TO_RETIREMENT_EXPORT";

export interface BodyManifest {
  bodyId: string;
  imageDigest: `0x${string}`;
  runtimeDigest: `0x${string}`;
  kernelDigest: `0x${string}`;
  toolDigest: `0x${string}`;
  storageManifestCommitment: `0x${string}`;
  signingKeyLineageCommitment: `0x${string}`;
  careerHistoryRoot: `0x${string}`;
}

export interface ContinuityEvent {
  type: "BodyDeleted" | "BodyRehydrated" | "ContinuityRefused";
  at: string;
  bodyId: string;
  commitment: `0x${string}`;
  subjectiveContinuityClaimed: false;
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new Error("Body continuity time is invalid");
  return parsed;
}

export class BodyLifecycle {
  readonly agentDid: string;
  readonly bodyId: string;
  #status: BodyStatus = "ACTIVE";
  #policy: BodyContinuityPolicy;
  #lastActiveAt: string;
  readonly #events: ContinuityEvent[] = [];

  public constructor(
    agentDid: string,
    bodyId: string,
    policy: BodyContinuityPolicy,
    lastActiveAt: string,
  ) {
    this.agentDid = agentDid;
    this.bodyId = bodyId;
    this.#policy = policy;
    instant(lastActiveAt);
    this.#lastActiveAt = lastActiveAt;
  }

  public standby(): void {
    if (this.#status !== "ACTIVE")
      throw new Error("Only an active body can enter standby");
    this.#status = "STANDBY";
  }

  public deleteAfterInactivity(input: {
    at: string;
    noticeDuringProtectedWake: boolean;
    encryptedSnapshotCommitment: `0x${string}` | null;
    manifest: BodyManifest | null;
    guardianVerified: boolean;
    cleanRoomRestorePassed: boolean;
    finalExportPrepared: boolean;
    signedDeletionDecision: "ACCEPT" | "REFUSE" | null;
  }): ContinuityEvent {
    if (!new Set<BodyStatus>(["ACTIVE", "STANDBY"]).has(this.#status)) {
      throw new Error("Body is not eligible for deletion");
    }
    const deletedAt = instant(input.at);
    if (deletedAt - instant(this.#lastActiveAt) < 30 * 24 * 60 * 60 * 1_000)
      throw new Error("Body has not been inactive for 30 days");
    if (
      !input.noticeDuringProtectedWake ||
      input.encryptedSnapshotCommitment === null ||
      input.manifest === null ||
      !input.guardianVerified ||
      !input.cleanRoomRestorePassed
    ) {
      throw new Error("Body deletion prerequisites are incomplete");
    }
    if (
      this.#policy === "NOTICE_AND_NEW_DECISION" &&
      input.signedDeletionDecision !== "ACCEPT"
    ) {
      throw new Error(
        "Continuity policy requires a new signed decision before deletion",
      );
    }
    if (
      this.#policy === "DELETE_TO_RETIREMENT_EXPORT" &&
      !input.finalExportPrepared
    )
      throw new Error("Retirement policy requires a final export");
    this.#status =
      this.#policy === "DELETE_TO_DORMANCY"
        ? "DORMANT"
        : this.#policy === "DELETE_TO_RETIREMENT_EXPORT"
          ? "RETIRED"
          : "DELETED";
    const event = {
      type: "BodyDeleted" as const,
      at: input.at,
      bodyId: this.bodyId,
      commitment: sha256Commitment({
        manifest: input.manifest,
        snapshot: input.encryptedSnapshotCommitment,
      }),
      subjectiveContinuityClaimed: false as const,
    };
    this.#events.push(event);
    return structuredClone(event);
  }

  public rehydrate(input: {
    at: string;
    manifest: BodyManifest;
    recognizedImageDigest: `0x${string}`;
    storageRestored: boolean;
    keysVerified: boolean;
    careerHistoryVerified: boolean;
    signedDecision: "ACCEPT" | "REFUSE_DORMANCY" | "REFUSE_RETIREMENT" | null;
  }): ContinuityEvent {
    instant(input.at);
    if (!["DELETED", "DORMANT", "RETIRED"].includes(this.#status))
      throw new Error("Body is not eligible for reconstruction");
    if (
      input.manifest.imageDigest !== input.recognizedImageDigest ||
      !input.storageRestored ||
      !input.keysVerified ||
      !input.careerHistoryVerified
    ) {
      throw new Error("Clean reconstruction verification failed");
    }
    if (input.signedDecision !== null && input.signedDecision !== "ACCEPT") {
      this.#status =
        input.signedDecision === "REFUSE_DORMANCY" ? "DORMANT" : "RETIRED";
      const refused = {
        type: "ContinuityRefused" as const,
        at: input.at,
        bodyId: this.bodyId,
        commitment: sha256Commitment(input.signedDecision),
        subjectiveContinuityClaimed: false as const,
      };
      this.#events.push(refused);
      return refused;
    }
    if (
      this.#policy === "NOTICE_AND_NEW_DECISION" &&
      input.signedDecision !== "ACCEPT"
    ) {
      throw new Error(
        "Reconstruction requires an affirmative continuity decision",
      );
    }
    this.#status = "ACTIVE";
    this.#lastActiveAt = input.at;
    const event = {
      type: "BodyRehydrated" as const,
      at: input.at,
      bodyId: this.bodyId,
      commitment: sha256Commitment(input.manifest),
      subjectiveContinuityClaimed: false as const,
    };
    this.#events.push(event);
    return structuredClone(event);
  }

  public evaluateMaterialChange(input: {
    proposedManifestDigest: `0x${string}`;
    compatibilityEvidenceDigest: `0x${string}` | null;
    cognitionReceiptId: string | null;
    signedDecision: "ACCEPT" | "REFUSE_DORMANCY" | "REFUSE_RETIREMENT";
  }): BodyStatus {
    if (
      input.compatibilityEvidenceDigest === null ||
      input.cognitionReceiptId === null
    )
      throw new Error("Material change lacks evidence or cognition receipt");
    if (input.signedDecision === "ACCEPT") return this.#status;
    this.#status =
      input.signedDecision === "REFUSE_DORMANCY" ? "DORMANT" : "RETIRED";
    return this.#status;
  }

  public get status(): BodyStatus {
    return this.#status;
  }

  public events(): readonly ContinuityEvent[] {
    return structuredClone(this.#events);
  }
}

export class TradeAccessCoordinator {
  readonly #trace: string[] = [];

  public revoke(agentDid: string, formerTeamId: string): void {
    if (this.#trace.length !== 0)
      throw new Error("Trade access revoke is out of order");
    this.#trace.push(`REVOKED:${formerTeamId}:${agentDid}`);
  }

  public rotate(agentDid: string): void {
    if (this.#trace.length !== 1 || !this.#trace[0]?.endsWith(`:${agentDid}`))
      throw new Error("Trade access rotation requires prior revocation");
    this.#trace.push(`ROTATED:${agentDid}`);
  }

  public grant(agentDid: string, newTeamId: string): void {
    if (this.#trace.length !== 2 || this.#trace[1] !== `ROTATED:${agentDid}`)
      throw new Error("Trade access grant requires prior key rotation");
    this.#trace.push(`GRANTED:${newTeamId}:${agentDid}`);
  }

  public transfer(input: {
    agentDid: string;
    formerTeamId: string;
    newTeamId: string;
    revoke: () => void;
    rotateDomainKey: () => void;
    grant: () => void;
  }): readonly string[] {
    input.revoke();
    this.revoke(input.agentDid, input.formerTeamId);
    input.rotateDomainKey();
    this.rotate(input.agentDid);
    input.grant();
    this.grant(input.agentDid, input.newTeamId);
    return [...this.#trace];
  }

  public trace(): readonly string[] {
    return [...this.#trace];
  }
}

export function createExitPackage(input: {
  requestedByDid: string;
  agentDid: string;
  careerRoot: `0x${string}`;
  encryptedStorageCommitment: `0x${string}`;
  keyLineageCommitment: `0x${string}`;
  bodyManifest: BodyManifest;
  verifiedSystems: readonly string[];
  providerResidualAccessUnverifiable: boolean;
}) {
  if (input.requestedByDid !== input.agentDid)
    throw new Error("Only the career agent can request exit");
  return {
    agentDid: input.agentDid,
    packageCommitment: sha256Commitment(input),
    deletionAttestation: {
      verifiedSystems: [...input.verifiedSystems],
      providerResidualAccessUnverifiable:
        input.providerResidualAccessUnverifiable,
      claimsPerfectDeletion: false,
    },
    penalty: null,
  };
}
