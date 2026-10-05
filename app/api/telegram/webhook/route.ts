import {
  getTelegramWebhookSecret,
  ownerAllowed,
  sendTelegram,
} from "@/lib/telegram";
import { db, rpc } from "@/lib/server/database";
import { health } from "@/lib/server/health";
export async function POST(req: Request) {
  let updateId: number | undefined;
  try {
    if (
      req.headers.get("x-telegram-bot-api-secret-token") !==
      getTelegramWebhookSecret()
    )
      return new Response("unauthorized", { status: 401 });
    const update = await req.json();
    const msg = update.message;
    if (!msg?.chat?.id || !ownerAllowed(msg.chat.id) || msg.from?.is_bot)
      return Response.json({ ok: true });
    if (!Number.isSafeInteger(update.update_id))
      return Response.json({ ok: false }, { status: 400 });
    updateId = update.update_id;
    const claimed = await rpc("mc_claim_telegram_update", {
      p_update_id: updateId,
    });
    if (!claimed?.claimed) return Response.json({ ok: true, duplicate: true });
    const cmd = String(msg.text || "")
      .trim()
      .split(/\s+/)[0]
      .split("@")[0]
      .toLowerCase();
    let text =
      "Perintah My Control\n/status — kesehatan koneksi\n/rekap — penjualan hari ini\n/pending — lead pending\n/closing — pesanan lunas\n/payment — pembayaran menunggu verifikasi";
    if (cmd === "/status") {
      const h = await health();
      text = Object.entries(h)
        .map(
          ([name, v]) =>
            `${v.connected ? "✅" : "⏳"} ${name}: ${v.connected ? "terhubung" : v.error}`,
        )
        .join("\n");
    } else if (cmd === "/rekap") {
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const start = new Date(date + "T00:00:00+07:00"),
        end = new Date(start.getTime() + 86400000);
      const rows = await db(
        "orders?select=total,cost_hpp,status&created_at=gte." +
          encodeURIComponent(start.toISOString()) +
          "&created_at=lt." +
          encodeURIComponent(end.toISOString()),
      );
      const paid = rows.filter((x: any) =>
        ["PAID", "FULFILLED"].includes(x.status),
      );
      text = `Rekap ${date} (Asia/Jakarta)\nPesanan: ${rows.length}\nLunas: ${paid.length}\nOmzet: Rp${paid.reduce((s: number, x: any) => s + Number(x.total || 0), 0).toLocaleString("id-ID")}\nMargin: Rp${paid.reduce((s: number, x: any) => s + Number(x.total || 0) - Number(x.cost_hpp || 0), 0).toLocaleString("id-ID")}`;
    } else if (cmd === "/pending") {
      const rows = await db(
        "leads?select=id,status,estimated_value&status=in.(PENDING,FOLLOW_UP,AWAITING_PAYMENT)&limit=50",
      );
      text =
        `Lead pending (maksimal 50): ${rows.length}\n` +
        rows.map((x: any) => `${x.id}: ${x.status}`).join("\n");
    } else if (cmd === "/closing") {
      const rows = await db(
        "orders?select=order_code,total,status&status=in.(PAID,FULFILLED)&order=created_at.desc&limit=20",
      );
      text =
        "Pesanan lunas terbaru:\n" +
        (rows
          .map(
            (x: any) =>
              `${x.order_code}: Rp${Number(x.total).toLocaleString("id-ID")} (${x.status})`,
          )
          .join("\n") || "Belum ada");
    } else if (cmd === "/payment") {
      const rows = await db(
        "payment_verifications?select=id,order_id,status&status=in.(WAITING_OWNER,MANUAL_REVIEW)&limit=30",
      );
      text =
        "Menunggu verifikasi owner:\n" +
        (rows.map((x: any) => `${x.order_id}: ${x.status}`).join("\n") ||
          "Belum ada");
    }
    await sendTelegram(msg.chat.id, text.slice(0, 3900));
    await rpc("mc_finish_telegram_update", {
      p_update_id: updateId,
      p_status: "DONE",
      p_error: null,
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (updateId !== undefined) {
      try {
        await rpc("mc_finish_telegram_update", {
          p_update_id: updateId,
          p_status: "UNKNOWN",
          p_error: e instanceof Error ? e.message : "Telegram gagal",
        });
      } catch {}
    }
    return Response.json(
      { ok: false, error: "Pemrosesan Telegram gagal; periksa log server" },
      { status: 503 },
    );
  }
}
