export function dbConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Backend database belum dikonfigurasi");
  return { url: url.replace(/\/$/, ""), key };
}
export async function db(path: string, init: RequestInit = {}) {
  const { url, key } = dbConfig();
  const r = await fetch(url + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "content-type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  const raw = await r.text();
  let data: any;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error("Respons database tidak valid");
  }
  if (!r.ok) throw new Error(data?.message || "Database request gagal");
  return data;
}
export const rpc = (name: string, args: Record<string, unknown> = {}) =>
  db("rpc/" + name, { method: "POST", body: JSON.stringify(args) });
export async function chatId(id: string) {
  if (/^[\d]+@(c\.us|s\.whatsapp\.net|lid)$/.test(id)) return id;
  const rows = await db(
    "conversations?select=external_chat_id&id=eq." + encodeURIComponent(id),
  );
  const chat = rows?.[0]?.external_chat_id;
  if (
    typeof chat !== "string" ||
    !/^[\d]+@(c\.us|s\.whatsapp\.net|lid)$/.test(chat)
  )
    throw new Error(
      "Percakapan uji ini tidak memiliki tujuan WhatsApp yang valid",
    );
  return chat;
}

export async function activeChatId(id: string) {
  const chat = await chatId(id);
  const account = await rpc("mc_active_account");
  if (!account) throw new Error("Nomor bot belum dikonfigurasi");
  const rows = await db("mc_lead_state?select=chat_id&chat_id=eq." + encodeURIComponent(chat) +
    "&account_id=eq." + encodeURIComponent(account) + "&limit=1");
  if (!rows[0]) throw new Error("Percakapan tidak tersedia untuk nomor bot aktif");
  return chat;
}
