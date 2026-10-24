import { authorize, apiError } from "@/lib/server/session";
import { db, rpc } from "@/lib/server/database";
function browserControls(config: any) {
  const settings = { ...config.settings };
  for (const key of ["waha_session", "waha_sender_id", "waha_sender_lid", "waha_revision", "waha_webhook_url"]) delete settings[key];
  return { ...config, settings };
}
export async function GET(req: Request) {
  try {
    authorize(req);
    const [config, workers, errors, queue, metrics, attention] = await Promise.all([
      rpc("mc_read_web_controls"),
      db("mc_worker_controls?select=*&order=last_seen.desc"),
      db(
        "mc_error_log?select=id,component,category,error_message,created_at&order=created_at.desc&limit=20",
      ),
      db(
        "mc_outbound_jobs?select=id,chat_id,kind,status,last_error,created_at&status=in.(FAILED,UNKNOWN,RETRY,PROCESSING)&order=created_at.desc&limit=30",
      ),
      rpc("mc_queue_metrics"),
      rpc("mc_queue_attention"),
    ]);
    return Response.json(
      { ...browserControls(config), workers, errors, queue, metrics, attention },
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
    if (b.action === "ai_max_attempts") {
      if (!Number.isInteger(b.max) || b.max < 1 || b.max > 5)
        throw new Error("Percobaan AI harus 1–5");
      return Response.json(await rpc("mc_set_ai_max_attempts", { p_max: b.max }));
    }
    if (b.action === "ai_concurrency") {
      if (!Number.isInteger(b.max) || b.max < 1 || b.max > 6)
        throw new Error("Batas concurrency AI harus 1–6");
      return Response.json(await rpc("mc_set_ai_max_concurrency", { p_limit: b.max }));
    }
    if (b.action === "retry") {
      if (!/^[a-f0-9-]{36}$/i.test(b.id || ""))
        throw new Error("ID tidak valid");
      await rpc("mc_retry_web_failure", { p_job_id: b.id });
      return Response.json({ ok: true });
    }
    return Response.json(
      browserControls(await rpc("mc_save_web_controls", {
        p_version: b.version,
        p_settings: b.settings,
      })),
    );
  } catch (e) {
    return apiError(e);
  }
}
