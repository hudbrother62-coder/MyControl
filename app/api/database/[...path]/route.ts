import { authorize, apiError } from "@/lib/server/session";
import { dbConfig } from "@/lib/server/database";
const tables = new Set([
  "products",
  "leads",
  "orders",
  "customers",
  "payment_verifications",
  "payment_evidence",
  "conversations",
  "messages",
  "bot_settings",
  "integration_status",
]);
async function proxy(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    authorize(req, req.method !== "GET");
    const { path } = await params;
    if (path.length !== 1 || !tables.has(path[0]))
      return Response.json(
        { message: "Endpoint tidak diizinkan" },
        { status: 403 },
      );
    if (path[0] === "integration_status" && req.method !== "GET")
      return Response.json(
        { message: "Status integrasi hanya baca" },
        { status: 403 },
      );
    const { url, key } = dbConfig();
    const headers: Record<string, string> = {
      apikey: key,
      Authorization: "Bearer " + key,
      "content-type": "application/json",
    };
    for (const h of ["prefer", "range", "range-unit", "accept"]) {
      const v = req.headers.get(h);
      if (v) headers[h] = v;
    }
    const r = await fetch(
      url + "/rest/v1/" + path[0] + new URL(req.url).search,
      {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method)
          ? undefined
          : await req.text(),
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    const body = await r.text();
    return new Response(body || null, {
      status: r.status,
      headers: {
        "content-type": r.headers.get("content-type") || "application/json",
        ...(r.headers.get("content-range")
          ? { "content-range": r.headers.get("content-range")! }
          : {}),
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
