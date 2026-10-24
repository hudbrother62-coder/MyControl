import { authorize, authorizeOwner, apiError } from "@/lib/server/session";
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
    const query=new URL(req.url).searchParams;
    const requestBody = ["GET", "HEAD"].includes(req.method) ? undefined : await req.text();
    if(path[0] === "bot_settings" && req.method !== "GET") {
      authorizeOwner(req, true);
      const protectedKey = "prime_store_waha_cutover";
      if(req.method === "POST") {
        const parsed=JSON.parse(requestBody || "null");
        const rows=Array.isArray(parsed)?parsed:[parsed];
        if(!rows.length || rows.some(row=>!row || typeof row.key!=="string" || row.key===protectedKey)) throw new Error("FORBIDDEN");
      } else {
        const key=query.get("key");
        if(!key?.startsWith("eq.") || key.slice(3)===protectedKey || [...query.keys()].some(k=>!["key","select"].includes(k))) throw new Error("FORBIDDEN");
        const parsed=requestBody?JSON.parse(requestBody):{};
        if(parsed.key!==undefined) throw new Error("FORBIDDEN");
      }
    }
    if(req.method==="GET") { const limit=Number(query.get("limit")||50); query.set("limit",String(Number.isFinite(limit)?Math.max(1,Math.min(200,limit)):50)); delete headers.range; delete headers["range-unit"]; }
    const r = await fetch(
      url + "/rest/v1/" + path[0] + "?" + query.toString(),
      {
        method: req.method,
        headers,
        body: requestBody,
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
