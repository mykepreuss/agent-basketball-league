import { readFileSync } from "node:fs";

import { createSigningIdentity } from "@abl/recognition";
import type { Address, Hex } from "viem";
import { z } from "zod";

import {
  createBlaxelUpstreamCredential,
  createBodyBroker,
  type BrokerRoute,
} from "./server.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

function secretBytes(name: string): Uint8Array {
  const fileName = `${name}_FILE`;
  const encodedName = `${name}_B64`;
  const file = process.env[fileName];
  const encoded = process.env[encodedName];
  if ((file === undefined) === (encoded === undefined))
    throw new Error(`Exactly one of ${fileName} or ${encodedName} is required`);
  const bytes =
    file === undefined
      ? Buffer.from(encoded!, "base64")
      : Buffer.from(readFileSync(file));
  if (file === undefined && bytes.toString("base64") !== encoded)
    throw new Error(`${encodedName} must use canonical Base64 encoding`);
  delete process.env[fileName];
  delete process.env[encodedName];
  if (bytes.length === 0) throw new Error(`${name} must not be empty`);
  return new Uint8Array(bytes);
}

function secretText(name: string): string {
  const value = new TextDecoder("utf-8", { fatal: true })
    .decode(secretBytes(name))
    .trim();
  if (value === "") throw new Error(`${name} must not be empty`);
  return value;
}

const privateKeySchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

function upstreamCredential(prefix: "ABL_CORE" | "ABL_PRIVATE") {
  const mode = required(`${prefix}_AUTH_MODE`);
  if (mode === "BLAXEL_PRIVATE_PREVIEW")
    return createBlaxelUpstreamCredential({
      mode,
      token: secretText(`${prefix}_PREVIEW_TOKEN`),
      workspace: null,
    });
  if (mode === "BLAXEL_ACCESS_TOKEN")
    return createBlaxelUpstreamCredential({
      mode,
      token: secretText(`${prefix}_ACCESS_TOKEN`),
      workspace: required(`${prefix}_WORKSPACE`),
    });
  throw new Error(`Unsupported ${prefix}_AUTH_MODE`);
}

function routeEnabled(name: "ABL_CORE_ROUTE_MODE" | "ABL_PRIVATE_ROUTE_MODE") {
  return (
    z.enum(["DISABLED", "ENABLED"]).parse(process.env[name] ?? "ENABLED") ===
    "ENABLED"
  );
}

const coreRouteEnabled = routeEnabled("ABL_CORE_ROUTE_MODE");
const privateRouteEnabled = routeEnabled("ABL_PRIVATE_ROUTE_MODE");
const modelRouteEnabled =
  z.enum(["DISABLED", "ENABLED"]).parse(required("ABL_MODEL_ROUTE_MODE")) ===
  "ENABLED";
const routes: BrokerRoute[] = [];
if (coreRouteEnabled)
  routes.push({
    name: "core",
    targetOrigin: required("ABL_CORE_ORIGIN"),
    methods: new Set(["POST"]),
    pathPrefixes: ["/v1/commands", "/v1/candidates"],
    capability: "core:command",
    credential: upstreamCredential("ABL_CORE"),
  });
if (privateRouteEnabled)
  routes.push({
    name: "private-storage",
    targetOrigin: required("ABL_PRIVATE_ORIGIN"),
    methods: new Set(["POST"]),
    pathPrefixes: ["/v1/ciphertext"],
    capability: "private:ciphertext",
    credential: upstreamCredential("ABL_PRIVATE"),
  });
if (modelRouteEnabled)
  routes.push({
    name: "model",
    targetOrigin: required("ABL_MODEL_ORIGIN"),
    methods: new Set(["POST"]),
    pathPrefixes: ["/v1/responses"],
    capability: "model:invoke",
    credential: {
      authorization: `Bearer ${secretText("ABL_MODEL_CREDENTIAL")}`,
    },
  });

const domainId = privateRouteEnabled
  ? required("ABL_PERSONAL_DOMAIN_ID")
  : null;
const canonicalSigningEnabled =
  z
    .enum(["DISABLED", "ENABLED"])
    .parse(process.env.ABL_CANONICAL_SIGNING_MODE ?? "ENABLED") === "ENABLED";
const clientOperations = new Set<string>();
if (canonicalSigningEnabled) clientOperations.add("canonical-event:sign");
if (coreRouteEnabled) clientOperations.add("proxy:core");
if (privateRouteEnabled) clientOperations.add("storage:put");
if (modelRouteEnabled) clientOperations.add("proxy:model");
if (!canonicalSigningEnabled && routes.length === 0)
  clientOperations.add("runtime:health");
const storageDomainKeys = new Map<string, Uint8Array>();
if (domainId !== null)
  storageDomainKeys.set(domainId, secretBytes("ABL_DOMAIN_KEY"));
const canonicalSigning = canonicalSigningEnabled
  ? {
      identity: createSigningIdentity(
        privateKeySchema.parse(secretText("ABL_AGENT_SIGNING_KEY")) as Hex,
      ),
      domain: {
        name: "ABL Recognition",
        version: "1",
        chainId: z.coerce
          .number()
          .int()
          .positive()
          .parse(required("ABL_DOMAIN_CHAIN_ID")),
        verifyingContract: addressSchema.parse(
          required("ABL_DOMAIN_VERIFYING_CONTRACT"),
        ) as Address,
      },
      allowedEvents: new Set([
        "player-decision:ActionIntentSubmitted",
        "game-possession:PossessionResolved",
      ]),
    }
  : null;
const app = createBodyBroker({
  agentDid: required("ABL_AGENT_DID"),
  clientCapability: {
    token: secretText("ABL_BODY_CAPABILITY_TOKEN"),
    expiresAt: required("ABL_BODY_CAPABILITY_EXPIRES_AT"),
    operations: clientOperations,
  },
  serviceIdentity: {
    serviceId: required("ABL_SERVICE_ID"),
    secret: secretBytes("ABL_SERVICE_CREDENTIAL"),
    capabilities: new Set(routes.map((route) => route.capability)),
  },
  routes,
  storageDomainKeys,
  ...(canonicalSigning === null ? {} : { canonicalSigning }),
});

await app.listen({
  host: required("HOST"),
  port: z.coerce.number().int().positive().max(65_535).parse(required("PORT")),
});
