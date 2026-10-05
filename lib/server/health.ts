import { db } from "./database";
async function check(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
export async function health() {
  const result: Record<string, any> = {};
  await Promise.all(
    ["DATABASE", "WAHA", "N8N", "TELEGRAM"].map(async (name) => {
      try {
        let detail: any;
        if (name === "DATABASE")
          detail = await db("mc_lead_state?select=chat_id&limit=1");
        if (name === "WAHA") {
          if (!process.env.WAHA_BASE_URL || !process.env.WAHA_API_KEY)
            throw new Error("Belum dikonfigurasi");
          detail = await check(
            process.env.WAHA_BASE_URL.replace(/\/$/, "") +
              "/api/sessions/" +
              encodeURIComponent(process.env.WAHA_SESSION || "default"),
            { "X-Api-Key": process.env.WAHA_API_KEY },
          );
          if (detail.status !== "WORKING")
            throw new Error("Session " + detail.status);
        }
        if (name === "N8N") {
          if (!process.env.N8N_BASE_URL) throw new Error("Belum dikonfigurasi");
          detail = await check(
            process.env.N8N_BASE_URL.replace(/\/$/, "") + "/healthz",
          );
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
                  session: process.env.WAHA_SESSION || "default",
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
