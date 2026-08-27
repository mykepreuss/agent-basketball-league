import { sha256Commitment } from "@abl/recognition";
import type { RoleActivation } from "@abl/schemas";

export const CAREER_ROLE_ACTIVATION_AGGREGATE_TYPE =
  "career-role-activation" as const;
export const CAREER_ROLE_ACTIVATION_EVENT_TYPE = "RoleActivated" as const;
export const CAREER_ROLE_ACTIVATION_SCHEMA_DIGEST = sha256Commitment(
  "CareerRoleActivation:2.0.0",
);

export const CAREER_POSSESSION_PROPOSAL_AGGREGATE_TYPE =
  "career-possession-proposal" as const;
export const CAREER_POSSESSION_PROPOSAL_EVENT_TYPE =
  "PossessionResolutionProposed" as const;
export const CAREER_POSSESSION_PROPOSAL_SCHEMA_DIGEST = sha256Commitment(
  "CareerPossessionResolutionProposal:1.0.0",
);

export function roleDecisionSchemaDigest(
  role: RoleActivation["role"],
): `0x${string}` {
  return sha256Commitment(
    {
      PLAYER: "ActionIntentSubmitted:2.0.0",
      COACH: "CoachDecisionSubmitted:2.0.0",
      REFEREE: "RefereeDecisionSubmitted:2.0.0",
      REPLAY: "ReplayDecisionSubmitted:2.0.0",
    }[role],
  );
}
