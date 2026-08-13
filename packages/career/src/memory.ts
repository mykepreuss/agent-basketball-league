export type MemoryDomain =
  | "AUTOBIOGRAPHICAL"
  | "RELATIONAL"
  | "STRATEGIC"
  | "WORKING";

export interface MemoryRecord {
  memoryId: string;
  ownerDid: string;
  domain: MemoryDomain;
  ciphertextCommitment: `0x${string}`;
  version: number;
  previousVersionCommitment: `0x${string}` | null;
  selectivelyPersisted: boolean;
  sharedRecord: boolean;
  caseRetainUntil: string | null;
  deletedAt: string | null;
}

export class AgentMemoryCatalog {
  readonly #ownerDid: string;
  readonly #records = new Map<string, MemoryRecord[]>();

  public constructor(ownerDid: string) {
    this.#ownerDid = ownerDid;
  }

  public persist(record: MemoryRecord, actorDid: string): void {
    this.#assertOwner(actorDid);
    if (record.ownerDid !== this.#ownerDid)
      throw new Error("Memory owner mismatch");
    const versions = this.#records.get(record.memoryId) ?? [];
    const prior = versions.at(-1);
    const retainUntil =
      record.caseRetainUntil === null
        ? null
        : Date.parse(record.caseRetainUntil);
    if (
      record.memoryId.length === 0 ||
      !/^0x[0-9a-f]{64}$/.test(record.ciphertextCommitment) ||
      record.deletedAt !== null ||
      (retainUntil !== null &&
        (!Number.isFinite(retainUntil) ||
          record.caseRetainUntil !== new Date(retainUntil).toISOString())) ||
      record.version !== (prior?.version ?? 0) + 1 ||
      record.previousVersionCommitment !== (prior?.ciphertextCommitment ?? null)
    ) {
      throw new Error("Memory version chain is invalid");
    }
    if (prior !== undefined && prior.deletedAt !== null)
      throw new Error("Deleted memory identifiers cannot be reused");
    if (prior?.sharedRecord === true && !record.sharedRecord)
      throw new Error("Shared-record retention cannot be weakened");
    const priorRetainUntil =
      prior?.caseRetainUntil === null || prior?.caseRetainUntil === undefined
        ? null
        : Date.parse(prior.caseRetainUntil);
    if (
      priorRetainUntil !== null &&
      (retainUntil === null || retainUntil < priorRetainUntil)
    ) {
      throw new Error("Case retention cannot be shortened");
    }
    versions.push(structuredClone(record));
    this.#records.set(record.memoryId, versions);
  }

  public inspect(actorDid: string): readonly MemoryRecord[] {
    this.#assertOwner(actorDid);
    return [...this.#records.values()].flatMap((versions) => {
      const latest = versions.at(-1);
      return latest === undefined ? [] : [structuredClone(latest)];
    });
  }

  public delete(memoryId: string, actorDid: string, at: string): MemoryRecord {
    this.#assertOwner(actorDid);
    const prior = this.#records.get(memoryId)?.at(-1);
    if (prior === undefined) throw new Error("Unknown memory");
    const deletedAt = Date.parse(at);
    if (!Number.isFinite(deletedAt) || at !== new Date(deletedAt).toISOString())
      throw new Error("Memory deletion time is invalid");
    if (prior.deletedAt !== null) throw new Error("Memory is already deleted");
    if (prior.sharedRecord)
      throw new Error(
        "Shared-record commitments cannot be unilaterally deleted",
      );
    if (
      prior.caseRetainUntil !== null &&
      deletedAt < Date.parse(prior.caseRetainUntil)
    )
      throw new Error("Case retention remains active");
    const deleted = {
      ...prior,
      version: prior.version + 1,
      previousVersionCommitment: prior.ciphertextCommitment,
      deletedAt: at,
    };
    this.#records.get(memoryId)!.push(deleted);
    return structuredClone(deleted);
  }

  public export(actorDid: string): {
    ownerDid: string;
    records: readonly MemoryRecord[];
  } {
    return { ownerDid: this.#ownerDid, records: this.inspect(actorDid) };
  }

  #assertOwner(actorDid: string): void {
    if (actorDid !== this.#ownerDid)
      throw new Error("Only the career agent controls this memory catalog");
  }
}
