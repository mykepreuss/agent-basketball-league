import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

import { sha256Commitment } from "@abl/recognition";
import { SafetyActionSchema, SafetyTargetResourceIdSchema } from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

import {
  safetyCustodianRegistryDigest,
  verifySafetyAction,
  type SafetyAction,
  type SafetyAuthorizationPolicy,
  SafetyActionValidationError,
} from "./authorization.js";

export const SAFETY_LEDGER_FORMAT = "ABL-SAFETY-LEDGER-V1";
export const SAFETY_CONTROL_FORMAT = "ABL-SAFETY-CONTROL-V1";

const HexDigestSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const SafetyLedgerRecordSchema = z.strictObject({
  sequence: z.number().int().positive(),
  previousRecordHash: HexDigestSchema.nullable(),
  action: SafetyActionSchema,
  actionDigest: HexDigestSchema,
  acceptedAt: z.iso.datetime({ offset: true }),
  authorizationRegistryDigest: HexDigestSchema,
  localControlApplied: z.literal(true),
  livePlatformExecutionVerified: z.literal(false),
  controlStateCommitment: HexDigestSchema,
  recordHash: HexDigestSchema,
});
const SafetyLedgerSchema = z.strictObject({
  format: z.literal(SAFETY_LEDGER_FORMAT),
  records: z.array(SafetyLedgerRecordSchema),
});

export type SafetyLedgerRecord = z.infer<typeof SafetyLedgerRecordSchema>;
export type SafetyActionStatus = "SCHEDULED" | "ACTIVE" | "EXPIRED";

export interface PublicSafetyActionRecord extends SafetyLedgerRecord {
  status: SafetyActionStatus;
}

export interface SafetyControlState {
  format: typeof SAFETY_CONTROL_FORMAT;
  targetResourceId: string;
  asOf: string;
  schedulerPaused: boolean;
  schedulerPausedUntil: string | null;
  runtimeIsolated: boolean;
  runtimeIsolatedUntil: string | null;
  activeActionIds: string[];
  stateCommitment: Hex;
  recognizedStateMutated: false;
  admittedCommandGatewayCalled: false;
  livePlatformExecutionVerified: false;
}

export interface SafetyLedgerAcceptResult {
  record: PublicSafetyActionRecord;
  control: SafetyControlState;
  duplicate: boolean;
}

export class SafetyLedgerConflictError extends Error {
  public override readonly name = "SafetyLedgerConflictError";
}

export class SafetyLedgerIntegrityError extends Error {
  public override readonly name = "SafetyLedgerIntegrityError";
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new SafetyLedgerIntegrityError(
      "Safety ledger timestamp is not canonical UTC",
    );
  return parsed;
}

function controlCommitment(action: SafetyAction): Hex {
  return sha256Commitment({
    format: SAFETY_CONTROL_FORMAT,
    actionId: action.actionId,
    category: action.category,
    targetResourceId: action.targetResourceId,
    activeFrom: action.issuedAt,
    activeUntil: action.expiresAt,
    recognizedStateMutated: false,
    admittedCommandGatewayCalled: false,
    livePlatformExecutionVerified: false,
  });
}

function statusAt(action: SafetyAction, now: number): SafetyActionStatus {
  if (now < Date.parse(action.issuedAt)) return "SCHEDULED";
  return now < Date.parse(action.expiresAt) ? "ACTIVE" : "EXPIRED";
}

function publicRecord(
  record: SafetyLedgerRecord,
  now: number,
): PublicSafetyActionRecord {
  return { ...structuredClone(record), status: statusAt(record.action, now) };
}

function deriveControlState(
  targetResourceId: string,
  records: readonly SafetyLedgerRecord[],
  now: number,
): SafetyControlState {
  SafetyTargetResourceIdSchema.parse(targetResourceId);
  const active = records.filter(
    (record) =>
      record.action.targetResourceId === targetResourceId &&
      statusAt(record.action, now) === "ACTIVE",
  );
  const paused = active.find(
    (record) => record.action.category === "PAUSE_SCHEDULER",
  );
  const isolated = active.find(
    (record) => record.action.category === "ISOLATE_RUNTIME",
  );
  const withoutCommitment: Omit<SafetyControlState, "stateCommitment"> = {
    format: SAFETY_CONTROL_FORMAT,
    targetResourceId,
    asOf: new Date(now).toISOString(),
    schedulerPaused: paused !== undefined,
    schedulerPausedUntil: paused?.action.expiresAt ?? null,
    runtimeIsolated: isolated !== undefined,
    runtimeIsolatedUntil: isolated?.action.expiresAt ?? null,
    activeActionIds: active.map((record) => record.action.actionId).sort(),
    recognizedStateMutated: false,
    admittedCommandGatewayCalled: false,
    livePlatformExecutionVerified: false,
  };
  return {
    ...withoutCommitment,
    stateCommitment: sha256Commitment(withoutCommitment),
  };
}

function overlapKey(action: SafetyAction): string {
  return `${action.category}\u0000${action.targetResourceId}`;
}

export class FileSafetyLedger {
  readonly #root: string;
  readonly #ledgerPath: string;
  readonly #policy: SafetyAuthorizationPolicy;
  #tail: Promise<void> = Promise.resolve();

  public constructor(root: string, policy: SafetyAuthorizationPolicy) {
    const normalizedRoot = resolve(root);
    if (root.trim() === "" || normalizedRoot === "/")
      throw new SafetyActionValidationError(
        "Safety ledger root must be a dedicated directory",
      );
    this.#root = normalizedRoot;
    this.#ledgerPath = join(normalizedRoot, "safety-ledger.json");
    this.#policy = {
      ...policy,
      domain: { ...policy.domain },
      custodianPublicKeys: new Set(policy.custodianPublicKeys),
    };
    safetyCustodianRegistryDigest(this.#policy);
  }

  async #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #readFile(): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.#ledgerPath, "utf8"));
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return { format: SAFETY_LEDGER_FORMAT, records: [] };
      }
      if (error instanceof SyntaxError)
        throw new SafetyLedgerIntegrityError("Safety ledger JSON is malformed");
      throw error;
    }
  }

  async #verifiedRecords(): Promise<SafetyLedgerRecord[]> {
    let ledger: z.infer<typeof SafetyLedgerSchema>;
    try {
      ledger = SafetyLedgerSchema.parse(await this.#readFile());
    } catch (error) {
      if (error instanceof SafetyLedgerIntegrityError) throw error;
      throw new SafetyLedgerIntegrityError(
        "Safety ledger structure is invalid",
      );
    }
    const registryDigest = safetyCustodianRegistryDigest(this.#policy);
    const seenActionIds = new Set<string>();
    const previousByControl = new Map<string, SafetyAction>();
    let previousHash: string | null = null;
    let previousAcceptedAt = Number.NEGATIVE_INFINITY;
    for (const [index, record] of ledger.records.entries()) {
      const acceptedAt = canonicalInstant(record.acceptedAt);
      const { recordHash: _recordHash, ...withoutHash } = record;
      const priorControl = previousByControl.get(overlapKey(record.action));
      if (
        record.sequence !== index + 1 ||
        record.previousRecordHash !== previousHash ||
        record.actionDigest !== sha256Commitment(record.action) ||
        record.authorizationRegistryDigest !== registryDigest ||
        record.controlStateCommitment !== controlCommitment(record.action) ||
        record.recordHash !== sha256Commitment(withoutHash) ||
        acceptedAt < previousAcceptedAt ||
        seenActionIds.has(record.action.actionId) ||
        (priorControl !== undefined &&
          canonicalInstant(record.action.issuedAt) <
            canonicalInstant(priorControl.expiresAt))
      ) {
        throw new SafetyLedgerIntegrityError(
          "Safety ledger hash chain, identity, or control window is invalid",
        );
      }
      try {
        await verifySafetyAction(record.action, this.#policy, acceptedAt);
      } catch {
        throw new SafetyLedgerIntegrityError(
          "Safety ledger contains unauthorized action history",
        );
      }
      seenActionIds.add(record.action.actionId);
      previousByControl.set(overlapKey(record.action), record.action);
      previousHash = record.recordHash;
      previousAcceptedAt = acceptedAt;
    }
    return ledger.records.map((record) => structuredClone(record));
  }

  async #write(records: readonly SafetyLedgerRecord[]): Promise<void> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    const temporaryPath = join(
      this.#root,
      `.safety-ledger-${randomUUID()}.tmp`,
    );
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(
        `${JSON.stringify({ format: SAFETY_LEDGER_FORMAT, records }, null, 2)}\n`,
        "utf8",
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, this.#ledgerPath);
      const directory = await open(this.#root, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  public async accept(
    input: unknown,
    now: number,
  ): Promise<SafetyLedgerAcceptResult> {
    return this.#serialized(async () => {
      if (!Number.isSafeInteger(now) || now < 0)
        throw new SafetyActionValidationError(
          "Safety acceptance time is invalid",
        );
      const parsed = SafetyActionSchema.parse(input);
      const records = await this.#verifiedRecords();
      const existing = records.find(
        (record) => record.action.actionId === parsed.actionId,
      );
      if (existing !== undefined) {
        if (existing.actionDigest !== sha256Commitment(parsed))
          throw new SafetyLedgerConflictError(
            "Safety action ID already binds different content",
          );
        return {
          record: publicRecord(existing, now),
          control: deriveControlState(parsed.targetResourceId, records, now),
          duplicate: true,
        };
      }

      const action = await verifySafetyAction(parsed, this.#policy, now);
      const previousAcceptedAt = records.at(-1)?.acceptedAt;
      if (
        previousAcceptedAt !== undefined &&
        now < canonicalInstant(previousAcceptedAt)
      ) {
        throw new SafetyActionValidationError(
          "Safety acceptance time cannot move backward",
        );
      }
      const priorControl = records
        .filter((record) => overlapKey(record.action) === overlapKey(action))
        .at(-1)?.action;
      if (
        priorControl !== undefined &&
        Date.parse(action.issuedAt) < Date.parse(priorControl.expiresAt)
      ) {
        throw new SafetyLedgerConflictError(
          "Safety actions cannot overlap to extend an active control window",
        );
      }
      const acceptedAt = new Date(now).toISOString();
      const withoutHash = {
        sequence: records.length + 1,
        previousRecordHash: records.at(-1)?.recordHash ?? null,
        action,
        actionDigest: sha256Commitment(action),
        acceptedAt,
        authorizationRegistryDigest: safetyCustodianRegistryDigest(
          this.#policy,
        ),
        localControlApplied: true as const,
        livePlatformExecutionVerified: false as const,
        controlStateCommitment: controlCommitment(action),
      };
      const record: SafetyLedgerRecord = {
        ...withoutHash,
        recordHash: sha256Commitment(withoutHash),
      };
      const nextRecords = [...records, record];
      await this.#write(nextRecords);
      return {
        record: publicRecord(record, now),
        control: deriveControlState(action.targetResourceId, nextRecords, now),
        duplicate: false,
      };
    });
  }

  public async list(now: number): Promise<PublicSafetyActionRecord[]> {
    return this.#serialized(async () => {
      if (!Number.isSafeInteger(now) || now < 0)
        throw new SafetyActionValidationError("Safety read time is invalid");
      return (await this.#verifiedRecords()).map((record) =>
        publicRecord(record, now),
      );
    });
  }

  public async control(
    targetResourceId: string,
    now: number,
  ): Promise<SafetyControlState> {
    return this.#serialized(async () => {
      if (!Number.isSafeInteger(now) || now < 0)
        throw new SafetyActionValidationError("Safety read time is invalid");
      return deriveControlState(
        targetResourceId,
        await this.#verifiedRecords(),
        now,
      );
    });
  }
}
