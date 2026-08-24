import { blStartJob } from "@blaxel/core";
import { z } from "zod";

import {
  assertDistinctRecoveryTargets,
  assessRecovery,
  collectDatabaseSnapshot,
} from "./recovery.js";

const TaskSchema = z.strictObject({
  operation: z.literal("VERIFY_CLEAN_ROOM_RESTORE"),
  releaseId: z.string().min(1).max(160),
});

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

const sourceUrl = required("ABL_RECOVERY_SOURCE_DATABASE_URL");
const restoredUrl = required("ABL_RECOVERY_RESTORED_DATABASE_URL");
const expectedTableCount = z.coerce
  .number()
  .int()
  .positive()
  .parse(required("ABL_RECOVERY_EXPECTED_TABLE_COUNT"));
const expectedPostgresMajor = z.coerce
  .number()
  .int()
  .positive()
  .parse(required("ABL_RECOVERY_EXPECTED_POSTGRES_MAJOR"));
assertDistinctRecoveryTargets(sourceUrl, restoredUrl);

blStartJob(async (candidate: unknown) => {
  const task = TaskSchema.parse(candidate);
  const [source, restored] = await Promise.all([
    collectDatabaseSnapshot(sourceUrl),
    collectDatabaseSnapshot(restoredUrl),
  ]);
  const assessment = assessRecovery(
    source,
    restored,
    expectedTableCount,
    expectedPostgresMajor,
  );
  const evidence = {
    evidenceClass: "LIVE_CLEAN_ROOM_DATABASE_RECOVERY",
    classification: "PRE_GENESIS_EXPERIMENT",
    recordedAt: new Date().toISOString(),
    releaseId: task.releaseId,
    operation: task.operation,
    ...assessment,
    sourceCredentialExposed: false,
    restoredCredentialExposed: false,
  };
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  if (assessment.status !== "PASS")
    throw new Error(
      `Clean-room recovery verification failed: ${assessment.blockers.join("; ")}`,
    );
});
