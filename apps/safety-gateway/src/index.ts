import {
  FileSafetyLedger,
  SAFETY_DOMAIN_NAME,
  SAFETY_DOMAIN_VERSION,
} from "@abl/safety";
import type { TypedDataDomain } from "viem";
import { z } from "zod";

import { createSafetyGateway } from "./server.js";

const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65_535)
  .parse(process.env.BL_SERVER_PORT ?? process.env.PORT ?? "8080");
const host = process.env.BL_SERVER_HOST ?? process.env.HOST ?? "0.0.0.0";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

const domain: TypedDataDomain = {
  name: SAFETY_DOMAIN_NAME,
  version: SAFETY_DOMAIN_VERSION,
  chainId: z.coerce
    .number()
    .int()
    .positive()
    .safe()
    .parse(required("ABL_SAFETY_DOMAIN_CHAIN_ID")),
  verifyingContract: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .parse(required("ABL_SAFETY_DOMAIN_VERIFYING_CONTRACT")) as `0x${string}`,
};
const custodianPublicKeys = z
  .array(z.string().regex(/^0x0[23][0-9a-fA-F]{64}$/))
  .min(1)
  .refine(
    (keys) =>
      new Set(keys.map((key) => key.toLowerCase())).size === keys.length,
  )
  .parse(JSON.parse(required("ABL_SAFETY_CUSTODIAN_PUBLIC_KEYS_JSON")));
const ledger = new FileSafetyLedger(required("ABL_SAFETY_LEDGER_ROOT"), {
  domain,
  custodianPublicKeys: new Set(custodianPublicKeys),
});
const app = createSafetyGateway({ ledger });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}

void app.listen({ port, host }).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
