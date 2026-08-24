import { NextResponse } from "next/server";

import { loadLaunchState } from "../data";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const launchState = await loadLaunchState();
    return NextResponse.json({
      status: "ok",
      service: "abl-spectator-arena",
      launchStage: launchState.launchStage,
      publicExposure: launchState.publicExposure,
      genesis: launchState.genesis,
      canonical: launchState.canonical,
    });
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        service: "abl-spectator-arena",
        reason: "public_api_unavailable",
        genesis: false,
        canonical: false,
      },
      { status: 503 },
    );
  }
}
