import { issueSession, apiError } from "@/lib/server/session";
export async function POST(req: Request) {
  try {
    if (req.headers.get("origin") !== new URL(req.url).origin)
      return Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    const body = await req.json();
    const username = String(body.username || "").trim(),
      password = String(body.password || "");
    if (!username || !password)
      return Response.json(
        { ok: false, error: "Username dan password wajib diisi" },
        { status: 400 },
      );
    const url =
        process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
      key =
        process.env.SUPABASE_ANON_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Login backend belum dikonfigurasi");
    const r = await fetch(
      url.replace(/\/$/, "") + "/rest/v1/rpc/login_mycontrol",
      {
        method: "POST",
        headers: { apikey: key, "content-type": "application/json" },
        body: JSON.stringify({ p_username: username, p_password: password }),
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    const data = await r.json();
    const row = Array.isArray(data) ? data[0] : data;
    if (!r.ok || !row?.session_token)
      return Response.json(
        { ok: false, error: "Username atau password salah" },
        { status: 401 },
      );
    const session = issueSession(row.role || "OWNER");
    return Response.json(
      { ok: true, role: row.role },
      {
        headers: {
          "Set-Cookie": `mc_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`,
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return apiError(e);
  }
}
