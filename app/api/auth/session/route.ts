import { authenticated } from "@/lib/server/session";
export async function GET(req: Request) {
  return Response.json(
    { ok: authenticated(req) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
