import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const publicApiOrigin = (
    process.env.ABL_PUBLIC_API_URL ?? "http://127.0.0.1:8080"
  ).replace(/\/$/, "");
  const headers: Record<string, string> = { accept: "text/event-stream" };
  const lastEventId = request.headers.get("last-event-id");
  if (lastEventId !== null && lastEventId !== "")
    headers["last-event-id"] = lastEventId;
  const previewToken = process.env.ABL_PUBLIC_API_PREVIEW_TOKEN;
  if (previewToken !== undefined)
    headers["x-blaxel-preview-token"] = previewToken;

  const upstream = await fetch(
    `${publicApiOrigin}/v1/public/games/${encodeURIComponent(id)}/live`,
    {
      cache: "no-store",
      headers,
      signal: request.signal,
    },
  );
  if (!upstream.ok || upstream.body === null) {
    return Response.json(
      { error: "live_projection_unavailable" },
      { status: upstream.status },
    );
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "cache-control": "no-cache, no-transform",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}
