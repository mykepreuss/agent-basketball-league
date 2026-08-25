import type {
  PublicFinalizedGameProjection,
  PublicGameProjection,
  PublicLiveGameSnapshot,
} from "@abl/projections";
import {
  DEFAULT_FOUNDING_COHORT_STATE,
  LaunchStateSchema,
  SchemaVersion,
} from "@abl/schemas";

export type PublicArenaHistoryClassification =
  | "PRE_GENESIS_EXPERIMENT"
  | "CANONICAL_GENESIS_HISTORY";

interface PublicArenaHistoryStatus {
  canonical: boolean;
  historyClassification: PublicArenaHistoryClassification;
  recognitionLevel:
    | "NONE"
    | "SIGNED_VALID"
    | "INDEPENDENTLY_WITNESSED"
    | "ONCHAIN_FINALIZED";
}

export type PublicArenaPossessionGame = Omit<
  PublicGameProjection,
  "canonical"
> &
  PublicArenaHistoryStatus;

export type PublicArenaFinalizedGame = Omit<
  PublicFinalizedGameProjection,
  "canonical"
> &
  PublicArenaHistoryStatus;

export type PublicArenaGame =
  | PublicArenaPossessionGame
  | PublicArenaFinalizedGame;

export type PublicArenaLiveSnapshot = Omit<
  PublicLiveGameSnapshot,
  "canonical"
> &
  PublicArenaHistoryStatus;

interface GamesResponse {
  state: string;
  canonical: boolean;
  historyClassification: PublicArenaHistoryClassification;
  recognitionLevel: PublicArenaHistoryStatus["recognitionLevel"];
  items: PublicArenaGame[];
}

interface LiveSnapshotsResponse {
  canonical: boolean;
  historyClassification: PublicArenaHistoryClassification;
  recognitionLevel: PublicArenaHistoryStatus["recognitionLevel"];
  snapshotFormat: "ABL-LIVE-GAME-SNAPSHOT-V1";
  items: PublicArenaLiveSnapshot[];
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
): projection is PublicArenaFinalizedGame {
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
  if (projection === undefined)
    throw new Error("No public game projection is available");
  const recognitionMatches =
    payload.recognitionLevel === projection.recognitionLevel;
  const preGenesisExperiment =
    payload.historyClassification === "PRE_GENESIS_EXPERIMENT" &&
    projection.historyClassification === "PRE_GENESIS_EXPERIMENT" &&
    payload.canonical === false &&
    projection.canonical === false &&
    recognitionMatches &&
    ["NONE", "SIGNED_VALID"].includes(payload.recognitionLevel);
  const canonicalGenesisHistory =
    payload.historyClassification === "CANONICAL_GENESIS_HISTORY" &&
    projection.historyClassification === "CANONICAL_GENESIS_HISTORY" &&
    payload.canonical === true &&
    projection.canonical === true &&
    recognitionMatches &&
    payload.recognitionLevel === "ONCHAIN_FINALIZED";
  if (!preGenesisExperiment && !canonicalGenesisHistory)
    throw new Error("Public game history classification is inconsistent");
  return projection;
}

export async function loadPossessionProof(
  baseUrl?: string,
  fetcher?: typeof fetch,
): Promise<PublicArenaPossessionGame> {
  const projection = await loadGameProof(baseUrl, fetcher);
  if (isFinalizedGame(projection)) {
    throw new Error("The latest public game is a finalized-game archive");
  }
  return projection;
}

export async function loadLiveGameSnapshots(
  gameId: string,
  baseUrl = process.env.ABL_PUBLIC_API_URL ?? "http://127.0.0.1:8080",
  fetcher: typeof fetch = fetch,
  previewToken = process.env.ABL_PUBLIC_API_PREVIEW_TOKEN,
): Promise<readonly PublicArenaLiveSnapshot[]> {
  const response = await fetcher(
    `${baseUrl}/v1/public/games/${encodeURIComponent(gameId)}/snapshots?limit=120`,
    {
      cache: "no-store",
      headers: requestHeaders(previewToken),
    },
  );
  if (!response.ok)
    throw new Error(`Live game snapshot request failed: ${response.status}`);
  const payload = (await response.json()) as LiveSnapshotsResponse;
  if (payload.snapshotFormat !== "ABL-LIVE-GAME-SNAPSHOT-V1")
    throw new Error("Live game snapshot contract is unsupported");
  if (
    payload.items.some(
      (snapshot) =>
        snapshot.gameId !== gameId ||
        snapshot.historyClassification !== payload.historyClassification ||
        snapshot.canonical !== payload.canonical ||
        snapshot.recognitionLevel !== payload.recognitionLevel,
    )
  ) {
    throw new Error("Live game snapshot classification is inconsistent");
  }
  return payload.items;
}
