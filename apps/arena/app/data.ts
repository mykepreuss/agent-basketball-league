import type { PublicGameProjection } from "@abl/projections";

interface GamesResponse {
  state: string;
  canonical: boolean;
  items: PublicGameProjection[];
}

export async function loadPossessionProof(
  baseUrl = process.env.ABL_PUBLIC_API_URL ?? "http://127.0.0.1:8080",
  fetcher: typeof fetch = fetch,
): Promise<PublicGameProjection> {
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
