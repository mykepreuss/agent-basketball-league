import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REHEARSAL_RECOGNITION_DOMAIN } from "../../basketball/src/index.js";
import {
  CandidateIntakeRepository,
  CandidateIntakeService,
  CandidateProvisioner,
  decryptCandidateEnvelope,
  issueCandidateChallenge,
  parseCandidateIntakePolicy,
} from "../../launch/src/candidate-intake.js";
import { describe, expect, it } from "vitest";

import {
  prepareFoundingAlphaCandidateAcceptance,
  prepareFoundingAlphaCandidateApplication,
} from "../../../scripts/prepare-founding-alpha-candidate.js";

const applicationId = "0198e000-0000-7000-8000-000000000001";
const candidateDid = "did:abl:founding-alpha-player-001";
const now = Date.parse("2026-08-22T18:00:00.000Z");

describe("Founding Alpha synthetic candidate preparation", () => {
  it("uses the signed encrypted intake path before the existing provisioner", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-alpha-candidate-"));
    try {
      const challengeSecret = new Uint8Array(32).fill(7);
      const challenge = issueCandidateChallenge({
        secret: challengeSecret,
        challengeId: "0198e000-0000-7000-8000-000000000010",
        candidateDid,
        nonce: "founding-alpha-challenge-nonce",
        now,
      });
      const challengePath = join(root, "challenge.json");
      await writeFile(challengePath, JSON.stringify(challenge), {
        mode: 0o600,
      });
      const candidateDirectory = join(root, "candidate");
      const prepared = await prepareFoundingAlphaCandidateApplication({
        challengePath,
        bodyImageReference:
          "sandbox/abl-alpha-r01-body-image:b05103ad9158991c22153",
        bodyProgramArchiveDigest: `0x${"a".repeat(64)}`,
        outputDirectory: candidateDirectory,
        now: () => now + 1_000,
      });
      expect(prepared).toMatchObject({ applicationId, candidateDid });
      const registration = JSON.parse(
        await readFile(
          join(candidateDirectory, "candidate-registration.json"),
          "utf8",
        ),
      );
      const policy = parseCandidateIntakePolicy({
        mode: "CAPPED_PUBLIC",
        roleCapacity: { PLAYER: 1 },
        invitedCandidateDids: [],
        credibleOpportunityAt: {
          PLAYER: new Date(now + 86_400_000).toISOString(),
        },
      });
      const repository = new CandidateIntakeRepository(join(root, "intake"));
      const intake = new CandidateIntakeService({
        challengeSecret,
        repository,
        policy,
        makeChallengeId: () => challenge.challengeId,
        makeNonce: () => challenge.nonce,
        now: () => now + 2_000,
      });
      const registrationResponse = await intake.register(registration);
      expect(registrationResponse.status.state).toBe("OFFERED");
      const responsePath = join(root, "registration-response.json");
      await writeFile(responsePath, JSON.stringify(registrationResponse), {
        mode: 0o600,
      });
      const expiredResponsePath = join(root, "expired-response.json");
      await writeFile(
        expiredResponsePath,
        JSON.stringify({
          ...registrationResponse,
          status: {
            ...registrationResponse.status,
            capacityDecision: {
              ...registrationResponse.status.capacityDecision!,
              offerExpiresAt: new Date(now + 2_000).toISOString(),
            },
          },
        }),
        { mode: 0o600 },
      );
      await expect(
        prepareFoundingAlphaCandidateAcceptance({
          registrationResponsePath: expiredResponsePath,
          candidateDirectory,
          now: () => now + 3_000,
        }),
      ).rejects.toThrow("authorized PLAYER offer");
      await prepareFoundingAlphaCandidateAcceptance({
        registrationResponsePath: responsePath,
        candidateDirectory,
        now: () => now + 3_000,
      });
      const acceptance = JSON.parse(
        await readFile(
          join(candidateDirectory, "candidate-acceptance.json"),
          "utf8",
        ),
      );
      await expect(intake.respond(acceptance)).resolves.toMatchObject({
        applicationId,
        state: "ACCEPTED",
      });
      const envelopeKey = Buffer.from(
        (
          await readFile(
            join(candidateDirectory, "candidate-envelope-key.base64url"),
            "utf8",
          )
        ).trim(),
        "base64url",
      );
      const provisioner = new CandidateProvisioner({
        challengeSecret,
        repository,
        decryptEnvelope: (application) =>
          decryptCandidateEnvelope(application, envelopeKey),
        candidateCommandDomain: REHEARSAL_RECOGNITION_DOMAIN,
        policy,
        makeReceiptId: () => "0198e000-0000-7000-8000-000000000011",
        now: () => now + 4_000,
      });
      await expect(provisioner.process(applicationId)).resolves.toMatchObject({
        applicationId,
        candidateDid,
        controlPlaneMode: "DRY_RUN",
        state: "VERIFIED_NOT_PROVISIONED",
        sandboxResourceName: null,
      });
      const publicState = await readFile(
        join(candidateDirectory, "candidate-public.json"),
        "utf8",
      );
      expect(publicState).toContain(candidateDid);
      expect(publicState).not.toMatch(/signing-key|envelope-key|privateKey/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
