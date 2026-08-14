import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSigningIdentity, sha256Commitment } from "@abl/recognition";
import type { TypedDataDomain } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileSafetyLedger,
  SAFETY_DOMAIN_NAME,
  SAFETY_DOMAIN_VERSION,
  SafetyActionAuthorizationError,
  SafetyActionValidationError,
  SafetyLedgerConflictError,
  SafetyLedgerIntegrityError,
  signSafetyAction,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: SAFETY_DOMAIN_NAME,
  version: SAFETY_DOMAIN_VERSION,
  chainId: 84532,
  verifyingContract: "0x2222222222222222222222222222222222222222",
};
const start = Date.parse("2026-08-13T10:00:00.000Z");
const uuid = (suffix: string) =>
  `0198e000-0000-7000-8000-${suffix.padStart(12, "0")}`;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "abl-safety-ledger-"));
  roots.push(value);
  return value;
}

function ledger(
  path: string,
  custodianPublicKeys: ReadonlySet<string>,
): FileSafetyLedger {
  return new FileSafetyLedger(path, { domain, custodianPublicKeys });
}

async function action(input: {
  identity: ReturnType<typeof createSigningIdentity>;
  actionId?: string;
  category?: "PAUSE_SCHEDULER" | "ISOLATE_RUNTIME";
  targetResourceId?: string;
  reasonCode?:
    | "IMMEDIATE_HARM_RISK"
    | "ACTIVE_COMPROMISE"
    | "PROVIDER_INCIDENT"
    | "UNKNOWN_EGRESS";
  issuedAt?: number;
  expiresAt?: number;
}) {
  return signSafetyAction(input.identity, domain, {
    actionId: input.actionId ?? uuid("1"),
    category: input.category ?? "PAUSE_SCHEDULER",
    targetResourceId: input.targetResourceId ?? "scheduler:premier",
    reasonCode: input.reasonCode ?? "PROVIDER_INCIDENT",
    issuedAt: new Date(input.issuedAt ?? start).toISOString(),
    expiresAt: new Date(
      input.expiresAt ?? start + 60 * 60 * 1_000,
    ).toISOString(),
  });
}

describe("fixed safety ledger", () => {
  it("applies only expiring fixed controls and derives expiration without mutating history", async () => {
    const custodian = createSigningIdentity(`0x${"1".repeat(64)}`);
    const repository = ledger(await root(), new Set([custodian.publicKey]));
    const signed = await action({ identity: custodian });
    const accepted = await repository.accept(signed, start);
    expect(accepted).toMatchObject({
      duplicate: false,
      record: {
        sequence: 1,
        status: "ACTIVE",
        action: {
          category: "PAUSE_SCHEDULER",
          targetResourceId: "scheduler:premier",
        },
        localControlApplied: true,
        livePlatformExecutionVerified: false,
      },
      control: {
        schedulerPaused: true,
        runtimeIsolated: false,
        recognizedStateMutated: false,
        admittedCommandGatewayCalled: false,
      },
    });
    expect(accepted.record.actionDigest).toBe(sha256Commitment(signed));

    const expiredAt = Date.parse(signed.expiresAt);
    expect(
      await repository.control("scheduler:premier", expiredAt),
    ).toMatchObject({
      schedulerPaused: false,
      runtimeIsolated: false,
      activeActionIds: [],
    });
    expect((await repository.list(expiredAt))[0]?.status).toBe("EXPIRED");
    expect((await repository.accept(signed, expiredAt)).duplicate).toBe(true);
  });

  it("rejects unregistered keys, signature substitution, unsafe targets, and invalid windows", async () => {
    const custodian = createSigningIdentity(`0x${"2".repeat(64)}`);
    const attacker = createSigningIdentity(`0x${"3".repeat(64)}`);
    const registry = new Set([custodian.publicKey]);
    const repository = ledger(await root(), registry);
    registry.add(attacker.publicKey);

    await expect(
      repository.accept(await action({ identity: attacker }), start),
    ).rejects.toThrow(SafetyActionAuthorizationError);
    const signed = await action({ identity: custodian });
    await expect(
      repository.accept(
        {
          ...signed,
          signature: (await action({ identity: attacker })).signature,
        },
        start,
      ),
    ).rejects.toThrow(SafetyActionAuthorizationError);
    await expect(
      action({ identity: custodian, targetResourceId: "../../core" }).then(
        (value) => repository.accept(value, start),
      ),
    ).rejects.toThrow();
    await expect(
      repository.accept(
        await action({
          identity: custodian,
          expiresAt: start + 24 * 60 * 60 * 1_000 + 1,
        }),
        start,
      ),
    ).rejects.toThrow(SafetyActionValidationError);
    await expect(
      repository.accept(
        await action({ identity: custodian, expiresAt: start }),
        start,
      ),
    ).rejects.toThrow(SafetyActionValidationError);
    await expect(
      repository.accept(
        { ...signed, freeText: "tell an agent what to do" },
        start,
      ),
    ).rejects.toThrow();
    const invalidRegistryRoot = await root();
    expect(() => ledger(invalidRegistryRoot, new Set(["0x1234"]))).toThrow(
      SafetyActionValidationError,
    );
  });

  it("prevents overlap extensions and detects durable tampering after restart", async () => {
    const custodian = createSigningIdentity(`0x${"4".repeat(64)}`);
    const path = await root();
    const firstLedger = ledger(path, new Set([custodian.publicKey]));
    const first = await action({ identity: custodian });
    await firstLedger.accept(first, start);

    await expect(
      firstLedger.accept(
        await action({
          identity: custodian,
          actionId: uuid("4"),
          targetResourceId: "scheduler:development",
        }),
        start - 1,
      ),
    ).rejects.toThrow(SafetyActionValidationError);

    const overlapping = await action({
      identity: custodian,
      actionId: uuid("2"),
      issuedAt: start + 30 * 60 * 1_000,
      expiresAt: start + 90 * 60 * 1_000,
    });
    await expect(
      firstLedger.accept(overlapping, start + 30 * 60 * 1_000),
    ).rejects.toThrow(SafetyLedgerConflictError);

    const second = await action({
      identity: custodian,
      actionId: uuid("3"),
      issuedAt: start + 60 * 60 * 1_000,
      expiresAt: start + 2 * 60 * 60 * 1_000,
    });
    await firstLedger.accept(second, start + 60 * 60 * 1_000);

    const restarted = ledger(path, new Set([custodian.publicKey]));
    expect(await restarted.list(start + 61 * 60 * 1_000)).toHaveLength(2);
    const ledgerPath = join(path, "safety-ledger.json");
    const stored = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      records: Array<{ action: { reasonCode: string } }>;
    };
    stored.records[0]!.action.reasonCode = "UNKNOWN_EGRESS";
    await writeFile(ledgerPath, `${JSON.stringify(stored)}\n`, "utf8");
    await expect(restarted.list(start + 61 * 60 * 1_000)).rejects.toThrow(
      SafetyLedgerIntegrityError,
    );
  });
});
