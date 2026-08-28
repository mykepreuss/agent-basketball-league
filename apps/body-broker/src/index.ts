import { readFileSync } from "node:fs";

import { createSigningIdentity } from "@abl/recognition";
import type { Address, Hex } from "viem";
import { z } from "zod";

import {
  createBlaxelUpstreamCredential,
  createBodyBroker,
  type BodyBrokerOptions,
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

function recognitionDomain() {
  return {
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
  };
}

const coreRouteEnabled = routeEnabled("ABL_CORE_ROUTE_MODE");
const privateRouteEnabled = routeEnabled("ABL_PRIVATE_ROUTE_MODE");
const cognitionRelayEnabled =
  z
    .enum(["DISABLED", "ENABLED"])
    .parse(process.env.ABL_COGNITION_RELAY_ROUTE_MODE ?? "DISABLED") ===
  "ENABLED";
const officialModelEnabled =
  z
    .enum(["DISABLED", "ENABLED"])
    .parse(process.env.ABL_OFFICIAL_MODEL_ROUTE_MODE ?? "DISABLED") ===
  "ENABLED";
const officialModelStateDirectory =
  process.env.ABL_OFFICIAL_MODEL_STATE_DIRECTORY ??
  "/tmp/abl-official-model-state";
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
if (cognitionRelayEnabled)
  routes.push({
    name: "cognition-relay",
    targetOrigin: required("ABL_COGNITION_RELAY_ORIGIN"),
    methods: new Set(["GET", "POST"]),
    pathPrefixes: ["/v1/internal"],
    capability: "cognition:deliver",
    credential: {
      authorization: `Bearer ${secretText("ABL_COGNITION_RELAY_INTERNAL_TOKEN")}`,
      "x-blaxel-preview-token": secretText("ABL_COGNITION_RELAY_PREVIEW_TOKEN"),
    },
  });
if (officialModelEnabled) {
  const workspace = z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
    .parse(required("ABL_OFFICIAL_MODEL_WORKSPACE"));
  const modelId = z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
    .parse(required("ABL_OFFICIAL_MODEL_ID"));
  routes.push({
    name: "official-model",
    targetOrigin: required("ABL_OFFICIAL_MODEL_ORIGIN"),
    methods: new Set(["POST"]),
    pathPrefixes: [`/${workspace}/models/${modelId}/v1/chat/completions`],
    capability: "official-model:infer",
    credential: createBlaxelUpstreamCredential({
      mode: "BLAXEL_ACCESS_TOKEN",
      token: secretText("ABL_OFFICIAL_MODEL_ACCESS_TOKEN"),
      workspace,
    }),
  });
}

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
if (privateRouteEnabled) {
  clientOperations.add("storage:get");
  clientOperations.add("storage:put");
  clientOperations.add("storage:delete");
  clientOperations.add("context:inspect");
}
if (cognitionRelayEnabled) clientOperations.add("proxy:cognition-relay");
if (officialModelEnabled) clientOperations.add("proxy:official-model");
if (!canonicalSigningEnabled && routes.length === 0)
  clientOperations.add("runtime:health");
const storageDomainKeys = new Map<string, Uint8Array>();
if (domainId !== null)
  storageDomainKeys.set(domainId, secretBytes("ABL_DOMAIN_KEY"));
const contextCatalog = JSON.parse(
  process.env.ABL_CONTEXT_CATALOG_JSON ?? "[]",
) as NonNullable<BodyBrokerOptions["contextCatalog"]>;
const canonicalSigning = canonicalSigningEnabled
  ? {
      identity: createSigningIdentity(
        privateKeySchema.parse(secretText("ABL_AGENT_SIGNING_KEY")) as Hex,
      ),
      domain: recognitionDomain(),
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
  contextCatalog,
  ...(canonicalSigning === null ? {} : { canonicalSigning }),
  ...(z
    .enum(["DISABLED", "ENABLED"])
    .parse(process.env.ABL_CAREER_CAPABILITY_RENEWAL_MODE ?? "DISABLED") ===
  "DISABLED"
    ? {}
    : {
        careerCapabilityRenewal: {
          signerAddress: addressSchema.parse(
            required("ABL_CAREER_SIGNER_ADDRESS"),
          ) as Address,
          domain: recognitionDomain(),
        },
      }),
  ...(officialModelEnabled
    ? {
        officialModelAsync: {
          routeName: "official-model",
          stateDirectory: officialModelStateDirectory,
        },
      }
    : {}),
});

await app.listen({
  host: required("HOST"),
  port: z.coerce.number().int().positive().max(65_535).parse(required("PORT")),
});
