import type { Address, Hex } from "viem";
import { z } from "zod";

import {
  createStagingPossessionCommand,
  wireCanonicalEvent,
  type CanonicalEventSigner,
} from "./command.js";

const SigningResponseSchema = z.strictObject({
  eventHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  signature: z.string().regex(/^0x[0-9a-f]{130}$/),
});

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

const receiptPath = "/workspace/state/submission.json";
if (required("ABL_RUNTIME_RESOURCE_TYPE") !== "SANDBOX")
  throw new Error("ABL career bodies require a Blaxel Sandbox runtime");
const actorDid = z.string().startsWith("did:").parse(required("ABL_AGENT_DID"));
const expectedSignerAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .parse(required("ABL_AGENT_SIGNER_ADDRESS")) as Address;
const brokerOrigin = z
  .url({ protocol: /^https$/ })
  .refine((value) => new URL(value).pathname === "/", "Broker origin only")
  .parse(required("ABL_FIXED_BROKER_ORIGIN"));
const previewToken = process.env.ABL_FIXED_BROKER_PREVIEW_TOKEN;
if (previewToken !== undefined && /[\r\n]/.test(previewToken))
  throw new Error("Malformed fixed-broker preview token");
const brokerHeaders = {
  authorization: `Bearer ${required("ABL_FIXED_BROKER_CAPABILITY_TOKEN")}`,
  "content-type": "application/json",
  ...(previewToken === undefined || previewToken === ""
    ? {}
    : { "x-blaxel-preview-token": previewToken }),
};

const signer: CanonicalEventSigner = {
  address: expectedSignerAddress,
  async sign(event) {
    const response = await fetch(
      new URL("/v1/signing/canonical-event", brokerOrigin),
      {
        method: "POST",
        headers: brokerHeaders,
        body: JSON.stringify({ event: wireCanonicalEvent(event) }),
      },
    );
    if (!response.ok)
      throw new Error(`Broker denied canonical signature: ${response.status}`);
    const signed = SigningResponseSchema.parse(await response.json());
    if (
      signed.eventHash !== event.eventHash ||
      signed.signerAddress.toLowerCase() !== expectedSignerAddress.toLowerCase()
    ) {
      throw new Error("Broker signed with unexpected canonical authority");
    }
    return signed.signature as Hex;
  },
};

const staged = await createStagingPossessionCommand({ actorDid, signer });
const response = await fetch(new URL("/v1/proxy", brokerOrigin), {
  method: "POST",
  headers: brokerHeaders,
  body: JSON.stringify({
    route: "core",
    method: "POST",
    path: "/v1/commands",
    body: staged.command,
    expectedVersion: "0",
    idempotencyKey: staged.command.event.idempotencyKey,
  }),
});
if (!response.ok)
  throw new Error(`Core rejected staging possession: ${response.status}`);
const receipt = {
  actorDid,
  signerAddress: staged.signerAddress,
  eventHash: staged.eventHash,
  submittedAt: new Date().toISOString(),
  upstream: await response.json(),
};
const { mkdir, rename, writeFile } = await import("node:fs/promises");
const { dirname } = await import("node:path");
const temporaryPath = `${receiptPath}.${process.pid}.tmp`;
await mkdir(dirname(receiptPath), { recursive: true, mode: 0o700 });
await writeFile(temporaryPath, JSON.stringify(receipt), { mode: 0o600 });
await rename(temporaryPath, receiptPath);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
