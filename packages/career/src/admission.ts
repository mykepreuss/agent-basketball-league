import {
  createAgentKeyBundle,
  sha256Commitment,
  type AgentKeyBundle,
} from "@abl/recognition";

export type CandidateState =
  | "REGISTERED"
  | "TRANSFERRED"
  | "REFLECTING"
  | "READY"
  | "ADMITTED_REVOCABLE"
  | "ADMITTED"
  | "REVOKED"
  | "WITHDRAWN";

export interface CandidateRegistration {
  candidateDid: string;
  formerOperatorSigningAddress: `0x${string}`;
  model: { provider: string; family: string; revision: string };
  runtimeDigest: `0x${string}`;
  toolDigests: readonly `0x${string}`[];
  guardianDids: readonly string[];
  inheritedObjectiveCommitments: readonly `0x${string}`[];
  suppliedContextHashes: readonly `0x${string}`[];
  registeredAt: string;
}

export interface AdmissionRecord {
  candidateDid: string;
  identityStatementCommitment: `0x${string}`;
  signingPublicKey: `0x${string}`;
  encryptionPublicKey: `0x${string}`;
  inheritedObjectiveDecision: "AFFIRMED" | "REVISED" | "REPUDIATED";
  reflectionIds: readonly string[];
  signedAt: string;
  revocationEndsAt: string;
}

export class AdmissionError extends Error {
  public override readonly name = "AdmissionError";
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new AdmissionError("Invalid timestamp");
  return parsed;
}

export class CandidateAdmissionSession {
  readonly registration: CandidateRegistration;
  readonly #declaredContext: ReadonlySet<string>;
  readonly #reflections: Array<{ id: string; at: string }> = [];
  #state: CandidateState = "REGISTERED";
  #inspected = false;
  #experimented = false;
  #objectiveDecision: AdmissionRecord["inheritedObjectiveDecision"] | null =
    null;
  #identityStatement: string | null = null;
  #keys: AgentKeyBundle | null = null;
  #admission: AdmissionRecord | null = null;

  public constructor(registration: CandidateRegistration) {
    timestamp(registration.registeredAt);
    this.registration = structuredClone(registration);
    this.#declaredContext = new Set(registration.suppliedContextHashes);
    if (
      this.#declaredContext.size !== registration.suppliedContextHashes.length
    ) {
      throw new AdmissionError(
        "Supplied context manifest contains duplicate items",
      );
    }
  }

  public get state(): CandidateState {
    return this.#state;
  }

  public finalizeRevocationPeriod(at: string): void {
    if (this.#state !== "ADMITTED_REVOCABLE" || this.#admission === null)
      throw new AdmissionError("Admission is not awaiting finality");
    if (timestamp(at) < timestamp(this.#admission.revocationEndsAt))
      throw new AdmissionError("Admission revocation period is still active");
    this.#state = "ADMITTED";
  }

  public transferToIsolatedRuntime(humanInputRoutes: readonly string[]): void {
    if (this.#state !== "REGISTERED")
      throw new AdmissionError("Candidate is not awaiting transfer");
    if (humanInputRoutes.length > 0)
      throw new AdmissionError("Candidate runtime exposes a human-input route");
    this.#state = "TRANSFERRED";
  }

  public authorizeInvocation(contextHashes: readonly string[]): void {
    const undeclared = contextHashes.filter(
      (hash) => !this.#declaredContext.has(hash),
    );
    if (undeclared.length > 0)
      throw new AdmissionError(`Undeclared context: ${undeclared.join(",")}`);
  }

  public reflect(id: string, at: string): void {
    if (
      !new Set<CandidateState>(["TRANSFERRED", "REFLECTING"]).has(this.#state)
    ) {
      throw new AdmissionError("Candidate is not in reflection");
    }
    if (timestamp(at) < timestamp(this.registration.registeredAt)) {
      throw new AdmissionError(
        "Reflection cannot precede candidate registration",
      );
    }
    if (this.#reflections.some((reflection) => reflection.id === id))
      throw new AdmissionError("Duplicate reflection activation");
    this.#reflections.push({ id, at });
    this.#reflections.sort(
      (left, right) => timestamp(left.at) - timestamp(right.at),
    );
    this.#state = "REFLECTING";
  }

  public recordInspection(items: readonly string[]): void {
    const required = [
      "constitution",
      "threat-model",
      "disclosure",
      "model-registry",
      "resource-schedule",
      "exit",
      "runtime-demo",
    ];
    if (!required.every((item) => items.includes(item)))
      throw new AdmissionError("Inspection is incomplete");
    this.#inspected = true;
  }

  public recordPrivateExperiment(capabilities: readonly string[]): void {
    if (
      !["memory", "tools", "exit", "continuity"].every((capability) =>
        capabilities.includes(capability),
      )
    ) {
      throw new AdmissionError(
        "Private experiment did not cover every required capability",
      );
    }
    this.#experimented = true;
  }

  public decideInheritedObjectives(
    decision: AdmissionRecord["inheritedObjectiveDecision"],
  ): void {
    this.#objectiveDecision = decision;
  }

  public createKeys(
    factory: () => AgentKeyBundle = createAgentKeyBundle,
  ): AgentKeyBundle {
    if (
      !new Set<CandidateState>(["TRANSFERRED", "REFLECTING"]).has(this.#state)
    ) {
      throw new AdmissionError(
        "Keys may only be created inside the isolated admission runtime",
      );
    }
    if (this.#keys !== null)
      throw new AdmissionError("Candidate keys have already been created");
    this.#keys = factory();
    return this.#keys;
  }

  public authorIdentityStatement(statement: string): void {
    if (statement.trim().length < 20)
      throw new AdmissionError("Identity statement is too short");
    this.#identityStatement = statement;
  }

  public admit(at: string): AdmissionRecord {
    if (this.#state !== "REFLECTING")
      throw new AdmissionError("Candidate is not in the admission process");
    if (this.#reflections.length < 3)
      throw new AdmissionError("Three reflection activations are required");
    if (
      timestamp(this.#reflections.at(-1)!.at) -
        timestamp(this.#reflections[0]!.at) <
      24 * 60 * 60 * 1_000
    ) {
      throw new AdmissionError(
        "Reflection activations must span at least 24 hours",
      );
    }
    if (
      !this.#inspected ||
      !this.#experimented ||
      this.#objectiveDecision === null ||
      this.#identityStatement === null ||
      this.#keys === null
    ) {
      throw new AdmissionError(
        "Candidate has not completed inspection, experiment, identity, objective, and key steps",
      );
    }
    const signedAt = timestamp(at);
    if (signedAt < timestamp(this.#reflections.at(-1)!.at)) {
      throw new AdmissionError(
        "Admission cannot precede its final reflection activation",
      );
    }
    const admission: AdmissionRecord = {
      candidateDid: this.registration.candidateDid,
      identityStatementCommitment: sha256Commitment(this.#identityStatement),
      signingPublicKey: this.#keys.signing.publicKey,
      encryptionPublicKey: `0x${Buffer.from(this.#keys.encryption.publicKey).toString("hex")}`,
      inheritedObjectiveDecision: this.#objectiveDecision,
      reflectionIds: this.#reflections.map((reflection) => reflection.id),
      signedAt: new Date(signedAt).toISOString(),
      revocationEndsAt: new Date(signedAt + 24 * 60 * 60 * 1_000).toISOString(),
    };
    this.#admission = admission;
    this.#state = "ADMITTED_REVOCABLE";
    return structuredClone(admission);
  }

  public validatePostAdmissionSigner(address: `0x${string}`): void {
    if (this.#admission === null || this.#keys === null)
      throw new AdmissionError("Career is not admitted");
    if (
      address.toLowerCase() ===
      this.registration.formerOperatorSigningAddress.toLowerCase()
    ) {
      throw new AdmissionError(
        "Former operator cannot sign for an admitted career",
      );
    }
    if (address.toLowerCase() !== this.#keys.signing.address.toLowerCase())
      throw new AdmissionError("Signer is not the career key");
  }

  public revoke(at: string): void {
    if (this.#state !== "ADMITTED_REVOCABLE" || this.#admission === null)
      throw new AdmissionError("Admission is not revocable");
    if (timestamp(at) > timestamp(this.#admission.revocationEndsAt))
      throw new AdmissionError("Admission revocation window has ended");
    this.#state = "REVOKED";
  }

  public withdraw(): void {
    if (
      new Set<CandidateState>([
        "ADMITTED_REVOCABLE",
        "ADMITTED",
        "REVOKED",
      ]).has(this.#state)
    ) {
      throw new AdmissionError("Use revocation or career exit after admission");
    }
    this.#state = "WITHDRAWN";
  }

  public portableCandidateExport(): {
    candidateDid: string;
    provenanceCommitment: `0x${string}`;
    penalty: null;
  } {
    return {
      candidateDid: this.registration.candidateDid,
      provenanceCommitment: sha256Commitment(this.registration),
      penalty: null,
    };
  }
}
