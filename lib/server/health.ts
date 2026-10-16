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
export async function health(names = ["DATABASE", "WAHA", "N8N", "TELEGRAM"]) {
  const result: Record<string, any> = {};
  const config = await rpc("mc_read_web_controls").catch(() => null);
  const wahaUrl = config?.settings?.waha_base_url || process.env.WAHA_BASE_URL;
  const n8nUrl = config?.settings?.n8n_base_url || process.env.N8N_BASE_URL;

  await Promise.all(
    names.map(async (name) => {
      try {
        let detail: any;
        if (name === "DATABASE")
          detail = await db("mc_lead_state?select=chat_id&limit=1");
        if (name === "WAHA") {
          if (!wahaUrl || !process.env.WAHA_API_KEY)
            throw new Error("Belum dikonfigurasi");
          detail = await check(
            wahaUrl.trim().replace(/\/+$/, "") +
              "/api/sessions/" +
              encodeURIComponent((process.env.WAHA_SESSION || "default").trim()),
            { "X-Api-Key": process.env.WAHA_API_KEY },
          );
          if (detail.status !== "WORKING")
            throw new Error("Session " + detail.status);
        }
        if (name === "N8N") {
          if (!n8nUrl) throw new Error("Belum dikonfigurasi");
          detail = await check(n8nUrl.trim().replace(/\/+$/, "") + "/healthz");
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
            name === "WAHA"
              ? {
                  session: (process.env.WAHA_SESSION || "default").trim(),
                  status: detail.status,
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
