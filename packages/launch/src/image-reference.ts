import { z } from "zod";

const OciDigestImageReferenceSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(/@sha256:[0-9a-f]{64}$/);
const BlaxelSandboxImageReferenceSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(
    /^sandbox\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?:(?:[a-z0-9]{12}|[0-9a-f]{21})$/,
  );

export const ImmutableSandboxImageReferenceSchema = z.union([
  OciDigestImageReferenceSchema,
  BlaxelSandboxImageReferenceSchema,
]);
