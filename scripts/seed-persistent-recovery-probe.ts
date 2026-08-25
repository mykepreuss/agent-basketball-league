import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { PostgresCanonicalStore } from "../packages/database/src/index.js";
import { seedPersistentRecoveryProbe } from "../packages/launch/src/index.js";
import { createSigningIdentity } from "../packages/recognition/src/index.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

if (process.argv.length !== 3)
  throw new Error(
    "Usage: seed-persistent-recovery-probe <new-secret-free-receipt.json>",
  );
if (required("ABL_RECOVERY_PROBE_AUTHORIZATION") !== "ABL-COMPLETION-01")
  throw new Error("Persistent recovery probe is not authorized");

const outputPath = resolve(process.argv[2]!);
const store = new PostgresCanonicalStore(required("DATABASE_URL"));
try {
  const receipt = await seedPersistentRecoveryProbe({
    store,
    domain: {
      name: "ABL Recognition",
      version: "1",
      chainId: z.coerce
        .number()
        .int()
        .positive()
        .parse(required("ABL_DOMAIN_CHAIN_ID")),
      verifyingContract: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/)
        .parse(required("ABL_DOMAIN_VERIFYING_CONTRACT")) as `0x${string}`,
    },
    identity: createSigningIdentity(
      z
        .string()
        .regex(/^0x[0-9a-fA-F]{64}$/)
        .parse(required("ABL_RECOVERY_PROBE_PRIVATE_KEY")) as `0x${string}`,
    ),
    occurredAt: z.iso
      .datetime({ offset: true })
      .parse(required("ABL_RECOVERY_PROBE_OCCURRED_AT")),
  });
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      eventId: receipt.eventId,
      eventCount: receipt.eventCount,
      outboxCount: receipt.outboxCount,
      duplicate: receipt.duplicate,
      secretValuesPrinted: false,
    })}\n`,
  );
} finally {
  await store.close();
}
