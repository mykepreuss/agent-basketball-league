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
    if (
      record.version !== (prior?.version ?? 0) + 1 ||
      record.previousVersionCommitment !== (prior?.ciphertextCommitment ?? null)
    ) {
      throw new Error("Memory version chain is invalid");
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
    if (prior.sharedRecord)
      throw new Error(
        "Shared-record commitments cannot be unilaterally deleted",
      );
    if (
      prior.caseRetainUntil !== null &&
      Date.parse(at) < Date.parse(prior.caseRetainUntil)
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
