import { CanonicalDatabaseProfileSchema } from "@abl/schemas";
import { z } from "zod";

export type CanonicalDatabaseProfile = z.infer<
  typeof CanonicalDatabaseProfileSchema
>;

export type CanonicalDatabaseStage = "PRODUCTION_V1" | "GENESIS";

export interface CanonicalDatabaseAssessment {
  stage: CanonicalDatabaseStage;
  ready: boolean;
  provider: string;
  missing: readonly string[];
}

export function assessCanonicalDatabaseProfile(
  candidate: unknown,
  stage: CanonicalDatabaseStage,
): CanonicalDatabaseAssessment {
  const profile = CanonicalDatabaseProfileSchema.parse(candidate);
  const missing: string[] = [];
  const maxRpoSeconds = stage === "GENESIS" ? 300 : 900;
  const maxRtoSeconds = stage === "GENESIS" ? 3_600 : 7_200;
  if (!profile.connection.tlsRequired) missing.push("TLS transport");
  if (!profile.connection.sourceRestricted)
    missing.push("source-restricted database ingress");
  if (!profile.connection.applicationCredentialsLeastPrivilege)
    missing.push("least-privilege application database credentials");
  if (!profile.connection.credentialRotationSupported)
    missing.push("credential rotation");
  if (!profile.transactions.serializable)
    missing.push("serializable transactions");
  if (!profile.transactions.advisoryLocks)
    missing.push("transaction-scoped aggregate locks");
  if (!profile.transactions.atomicOutbox) missing.push("atomic outbox");
  if (!profile.recovery.continuousBackup) missing.push("continuous backup");
  if (profile.recovery.maxRpoSeconds > maxRpoSeconds)
    missing.push(`${stage} recovery point objective`);
  if (profile.recovery.maxRtoSeconds > maxRtoSeconds)
    missing.push(`${stage} recovery time objective`);
  if (profile.recovery.cleanRoomRestoreVerifiedAt === null)
    missing.push("clean-room restore evidence");
  if (!profile.recovery.replayRootsMatched)
    missing.push("post-restore replay root equality");
  if (!profile.durability.encryptedAtRest) missing.push("encryption at rest");
  if (!profile.durability.independentBackupCopy)
    missing.push("independent backup copy");
  if (stage === "GENESIS") {
    if (!profile.recovery.pointInTimeRecovery)
      missing.push("point-in-time recovery");
    if (profile.recovery.restoreWindowDays < 30)
      missing.push("30-day restore window");
    if (!profile.durability.multiZone) missing.push("multi-zone durability");
    if (profile.connection.publicInternetAllowed)
      missing.push("private or explicitly restricted database ingress");
  }
  return {
    stage,
    ready: missing.length === 0,
    provider: profile.provider,
    missing,
  };
}
