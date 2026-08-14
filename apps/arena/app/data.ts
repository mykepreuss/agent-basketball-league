import type {
  PublicFinalizedGameProjection,
  PublicGameProjection,
} from "@abl/projections";

export type PublicArenaGame =
  | PublicGameProjection
  | PublicFinalizedGameProjection;

interface GamesResponse {
  state: string;
  canonical: boolean;
  items: PublicArenaGame[];
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
): Promise<PublicArenaGame> {
  const response = await fetcher(`${baseUrl}/v1/public/games`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(
      `Public game projection request failed: ${response.status}`,
    );
  const payload = (await response.json()) as GamesResponse;
  const projection = payload.items.at(-1);
  if (
    payload.state !== "REHEARSAL" ||
    payload.canonical !== true ||
    projection === undefined ||
    projection.canonical !== true
  ) {
    throw new Error("No canonical local rehearsal projection is available");
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
