import { randomBytes } from "node:crypto";

import {
  CandidateIntakeRepository,
  CandidateIntakeService,
  parseCandidateIntakePolicy,
} from "@abl/launch";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

import { assertCandidateEdgeIsolation, createCandidateEdge } from "./server.js";
import { createCandidateGateway } from "./gateway.js";
import { BlaxelJobCandidateProvisioningDispatcher } from "./provisioning-dispatcher.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

assertCandidateEdgeIsolation(process.env);
const mode = z
  .enum(["GATEWAY", "STORE"])
  .parse(process.env.ABL_CANDIDATE_EDGE_MODE ?? "STORE");
const envelopeRecipient =
  process.env.ABL_CANDIDATE_ENVELOPE_PUBLIC_KEY === undefined &&
  process.env.ABL_CANDIDATE_ENVELOPE_KEY_ID === undefined
    ? undefined
    : {
        keyId: required("ABL_CANDIDATE_ENVELOPE_KEY_ID"),
        publicKey: z
          .string()
          .regex(/^[A-Za-z0-9_-]{43}$/)
          .parse(required("ABL_CANDIDATE_ENVELOPE_PUBLIC_KEY")),
      };
const runnerPairing =
  process.env.ABL_RUNNER_BUNDLE_DIGEST === undefined
    ? undefined
    : {
        bundleDigest: z
          .string()
          .regex(/^0x[0-9a-f]{64}$/)
          .parse(required("ABL_RUNNER_BUNDLE_DIGEST")) as `0x${string}`,
        async createOffer(input: { sandboxResourceName: string }) {
          const response = await fetch(
            new URL(
              `/v1/internal/careers/${encodeURIComponent(input.sandboxResourceName)}/pairing-offer`,
              required("ABL_COMPETITION_DIRECTOR_ORIGIN"),
            ),
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${required("ABL_COMPETITION_INTERNAL_TOKEN")}`,
                "content-type": "application/json",
              },
              body: "{}",
              redirect: "error",
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!response.ok)
            throw new Error(`Career pairing offer failed: ${response.status}`);
          return (await response.json()) as never;
        },
        async status(input: { sandboxResourceName: string }) {
          const response = await fetch(
            new URL(
              `/v1/internal/careers/${encodeURIComponent(input.sandboxResourceName)}/runner-status`,
              required("ABL_COMPETITION_DIRECTOR_ORIGIN"),
            ),
            {
              headers: {
                authorization: `Bearer ${required("ABL_COMPETITION_INTERNAL_TOKEN")}`,
              },
              redirect: "error",
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!response.ok)
            throw new Error(`Career runner status failed: ${response.status}`);
          return (await response.json()) as never;
        },
      };
const app =
  mode === "GATEWAY"
    ? createCandidateGateway({
        storeOrigin: required("ABL_CANDIDATE_STORE_ORIGIN"),
        previewToken: required("ABL_CANDIDATE_STORE_PREVIEW_TOKEN"),
      })
    : createCandidateEdge({
        intake: new CandidateIntakeService({
          challengeSecret: Buffer.from(
            required("ABL_CANDIDATE_CHALLENGE_SECRET"),
            "base64url",
          ),
          repository: new CandidateIntakeRepository(
            required("ABL_CANDIDATE_INTAKE_PATH"),
          ),
          policy: parseCandidateIntakePolicy(
            JSON.parse(required("ABL_CANDIDATE_CAPACITY_POLICY_JSON")),
          ),
          makeChallengeId: uuidv7,
          makeNonce: () => randomBytes(24).toString("base64url"),
          ...(runnerPairing === undefined ? {} : { runnerPairing }),
        }),
        ...(envelopeRecipient === undefined ? {} : { envelopeRecipient }),
        provisioningToken: required("ABL_CANDIDATE_PROVISIONER_TOKEN"),
        authorityToken: required("ABL_CANDIDATE_AUTHORITY_TOKEN"),
        ...(process.env.ABL_CANDIDATE_PROVISIONING_JOB === undefined
          ? {}
          : {
              provisioningDispatcher:
                new BlaxelJobCandidateProvisioningDispatcher(
                  process.env.ABL_CANDIDATE_PROVISIONING_JOB,
                ),
            }),
      });

await app.listen({
  host: process.env.HOST ?? "0.0.0.0",
  port: Number.parseInt(process.env.PORT ?? "8080", 10),
});
