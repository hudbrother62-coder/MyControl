import { authorize, apiError } from "@/lib/server/session";
export async function POST(req: Request) {
  try {
    authorize(req, true);
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie":
            "mc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        },
      },
    );
  } catch (e) {
    return apiError(e);
  }
}
