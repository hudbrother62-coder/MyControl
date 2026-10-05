import { createHmac, timingSafeEqual } from "node:crypto";
export function signingKey() {
  const key =
    process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SESSION_SECRET belum dikonfigurasi");
  return key;
}
export function issueSession(role: string) {
  const payload = Buffer.from(
    JSON.stringify({ role, exp: Date.now() + 8 * 3600_000 }),
  ).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", signingKey()).update(payload).digest("base64url")
  );
}
export function authenticated(req: Request) {
  try {
    const token = req.headers
      .get("cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("mc_session="))
      ?.slice(11);
    if (!token) return false;
    const [payload, sig] = token.split(".");
    const expected = createHmac("sha256", signingKey())
      .update(payload)
      .digest("base64url");
    if (
      !sig ||
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    )
      return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}
export function authorize(req: Request, mutation = false) {
  if (!authenticated(req)) throw new Error("UNAUTHORIZED");
  if (mutation) {
    const origin = req.headers.get("origin");
    if (!origin || origin !== new URL(req.url).origin)
      throw new Error("FORBIDDEN");
  }
}
export function apiError(e: unknown) {
  const message = e instanceof Error ? e.message : "Terjadi kesalahan";
  return Response.json(
    { ok: false, error: message },
    {
      status:
        message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 503,
    },
  );
}
