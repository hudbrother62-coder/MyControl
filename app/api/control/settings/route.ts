import { authorize, apiError } from "@/lib/server/session";
import { db, rpc } from "@/lib/server/database";
export async function GET(req: Request) {
  try {
    authorize(req);
    const [config, workers, errors, queue] = await Promise.all([
      rpc("mc_read_web_controls"),
      db("mc_worker_controls?select=*&order=last_seen.desc"),
      db(
        "mc_error_log?select=id,component,category,error_message,created_at&order=created_at.desc&limit=20",
      ),
      db(
        "mc_outbound_jobs?select=id,chat_id,kind,status,last_error,created_at&status=in.(FAILED,UNKNOWN)&order=created_at.desc&limit=30",
      ),
    ]);
    return Response.json(
      { ...config, workers, errors, queue },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(req: Request) {
  try {
    authorize(req, true);
    const raw = await req.text();
    if (raw.length > 20000)
      return Response.json({ error: "Data terlalu besar" }, { status: 413 });
    const b = JSON.parse(raw);
    if (b.action === "retry") {
      if (!/^[a-f0-9-]{36}$/i.test(b.id || ""))
        throw new Error("ID tidak valid");
      await rpc("mc_retry_web_failure", { p_job_id: b.id });
      return Response.json({ ok: true });
    }
    return Response.json(
      await rpc("mc_save_web_controls", {
        p_version: b.version,
        p_settings: b.settings,
      }),
    );
  } catch (e) {
    return apiError(e);
  }
}
