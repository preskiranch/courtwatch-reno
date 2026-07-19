export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      ok: true,
      service: "courtwatch-web",
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
