import { probeWahaSession } from "./waha-probe";
import { db, rpc } from "./database";
async function check(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
export async function health(names = ["DATABASE", "WAHA", "N8N", "WORKER", "TELEGRAM"]) {
  const result: Record<string, any> = {};
  const config = await rpc("mc_read_web_controls").catch(() => null);
  const wahaUrl = config?.settings?.waha_base_url || process.env.WAHA_BASE_URL;
  const n8nUrl = config?.settings?.n8n_base_url || process.env.N8N_BASE_URL;

  const cutoverRows=names.includes("WAHA")?await db("bot_settings?select=value&key=eq.prime_store_waha_cutover&limit=1").catch(()=>[]):[];
  const cutover=cutoverRows?.[0]?.value||{};
  const targetSession=String(cutover.target_session||process.env.WAHA_SESSION||"default").trim();

  await Promise.all(
    names.map(async (name) => {
      try {
        let detail: any;
        if (name === "DATABASE")
          detail = await db("mc_lead_state?select=chat_id&limit=1");
        if (name === "WAHA") {
          if (!wahaUrl || !process.env.WAHA_API_KEY)
            throw new Error("Belum dikonfigurasi");
          const probe=await probeWahaSession({
            baseUrl:String(wahaUrl),apiKey:process.env.WAHA_API_KEY,
            session:targetSession,meId:cutover.target_me_id,lid:cutover.target_lid
          });
          detail=probe;
          if(!probe.ready)throw new Error(probe.error||"WAHA belum siap");

        }
        if (name === "N8N") {
          if (!n8nUrl) throw new Error("Belum dikonfigurasi");
          detail = await check(n8nUrl.trim().replace(/\/+$/, "") + "/healthz");
        }
        if (name === "WORKER") {
          const rows=await db("mc_campaign_runtime?select=session_name,last_seen,image_supported,video_supported&order=last_seen.desc&limit=15");
          const fresh=(rows||[]).filter((r:any)=>r.session_name===targetSession&&Date.now()-new Date(r.last_seen).getTime()<90000);
          detail={session:targetSession,status:fresh.length?"HEARTBEAT_OK":"STALE_OR_MISSING",
            image_supported:fresh.some((r:any)=>r.image_supported===true),
            video_supported:fresh.some((r:any)=>r.video_supported===true)};
          if(!fresh.length)throw new Error("Worker pengirim "+targetSession+" belum memiliki heartbeat aktif (90 detik). Periksa Publish workflow dan node Campaign Worker Heartbeat");
        }
        if (name === "TELEGRAM") {
          if (!process.env.TELEGRAM_BOT_TOKEN)
            throw new Error("Belum dikonfigurasi");
          detail = await check(
            "https://api.telegram.org/bot" +
              process.env.TELEGRAM_BOT_TOKEN +
              "/getMe",
          );
          if (!detail.ok) throw new Error("Telegram gagal");
        }
        result[name] = {
          connected: true,
          checkedAt: new Date().toISOString(),
          detail:
            name === "WORKER" ? detail : name === "WAHA"
              ? {
                  session: targetSession,
                  status: detail.status,
                  identity_verified:detail.identity_verified,
                }
              : undefined,
        };
      } catch (e) {
        result[name] = {
          connected: false,
          checkedAt: new Date().toISOString(),
          error: e instanceof Error ? e.message : "Tidak terhubung",
        };
      }
    }),
  );
  return result;
}
