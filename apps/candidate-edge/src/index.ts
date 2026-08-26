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
