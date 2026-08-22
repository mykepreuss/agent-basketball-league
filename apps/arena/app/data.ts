import type {
  PublicFinalizedGameProjection,
  PublicGameProjection,
} from "@abl/projections";
import {
  DEFAULT_FOUNDING_COHORT_STATE,
  LaunchStateSchema,
  SchemaVersion,
} from "@abl/schemas";

export type PublicArenaGame =
  | PublicGameProjection
  | PublicFinalizedGameProjection;

interface GamesResponse {
  state: string;
  canonical: boolean;
  items: PublicArenaGame[];
}

export type PublicArenaLaunchState = ReturnType<typeof LaunchStateSchema.parse>;

export const closedArenaLaunchState: PublicArenaLaunchState =
  LaunchStateSchema.parse({
    schemaVersion: SchemaVersion,
    launchStage: "LOCAL_GATE_1",
    operatingProfile: "PRE_GENESIS_CLOSED",
    recognitionLevel: "NONE",
    genesis: false,
    canonical: false,
    recognized: false,
    canonicalHistoryOpen: false,
    productionV1Ready: false,
    publicExposure: "NONE",
    candidateIntake: {
      mode: "CLOSED",
      capacityState: "CLOSED",
      requirementsUri: "/v1/discovery/candidate-requirements",
      capacityPolicyUri: "/v1/discovery/capacity-policy",
    },
    foundingCohort: DEFAULT_FOUNDING_COHORT_STATE,
    evidenceDigest: `0x${"0".repeat(64)}`,
    blockingReasons: ["Public launch state is unavailable"],
    updatedAt: "2026-08-22T00:00:00.000Z",
  });

function requestHeaders(previewToken: string | undefined) {
  return {
    accept: "application/json",
    ...(previewToken === undefined
      ? {}
      : { "x-blaxel-preview-token": previewToken }),
  };
}

export async function loadLaunchState(
  baseUrl = process.env.ABL_PUBLIC_API_URL ?? "http://127.0.0.1:8080",
  fetcher: typeof fetch = fetch,
  previewToken = process.env.ABL_PUBLIC_API_PREVIEW_TOKEN,
): Promise<PublicArenaLaunchState> {
  const response = await fetcher(`${baseUrl}/v1/discovery/launch-state`, {
    cache: "no-store",
    headers: requestHeaders(previewToken),
  });
  if (!response.ok)
    throw new Error(`Public launch-state request failed: ${response.status}`);
  return LaunchStateSchema.parse(await response.json());
}

function isFinalizedGame(
  projection: PublicArenaGame,
): projection is PublicFinalizedGameProjection {
  return (
    "projectionKind" in projection &&
    projection.projectionKind === "FINALIZED_GAME"
  );
}

export async function loadGameProof(
  baseUrl = process.env.ABL_PUBLIC_API_URL ?? "http://127.0.0.1:8080",
  fetcher: typeof fetch = fetch,
  previewToken = process.env.ABL_PUBLIC_API_PREVIEW_TOKEN,
): Promise<PublicArenaGame> {
  const response = await fetcher(`${baseUrl}/v1/public/games`, {
    cache: "no-store",
    headers: requestHeaders(previewToken),
  });
  if (!response.ok)
    throw new Error(
      `Public game projection request failed: ${response.status}`,
    );
  const payload = (await response.json()) as GamesResponse;
  const projection = payload.items.at(-1);
  if (
    payload.canonical !== true ||
    projection === undefined ||
    projection.canonical !== true
  ) {
    throw new Error("No canonical public game projection is available");
  }
  return projection;
}

export async function loadPossessionProof(
  baseUrl?: string,
  fetcher?: typeof fetch,
): Promise<PublicGameProjection> {
  const projection = await loadGameProof(baseUrl, fetcher);
  if (isFinalizedGame(projection)) {
    throw new Error("The latest public game is a finalized-game archive");
  }
  return projection;
}
