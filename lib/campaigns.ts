export type ContactInput = {
  phone: string;
  name: string;
  tags?: string;
  source?: string;
  consent?: boolean;
};
export type CampaignStep = {
  type: "TEXT" | "IMAGE" | "VIDEO";
  body: string;
  media_url?: string;
};
export function normalizePhone(value: string) {
  let phone = String(value)
    .trim()
    .replace(/[\s+().-]/g, "");
  if (/^8\d{8,12}$/.test(phone)) phone = "62" + phone;
  if (phone.startsWith("0")) phone = "62" + phone.slice(1);
  if (!/^[1-9][0-9]{7,14}$/.test(phone)) throw new Error("Nomor tidak valid");
  return phone;
}
export function parseContacts(raw: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const delimiter = raw.split(/\r?\n/)[0]?.includes(";") ? ";" : ",";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') {
      if (quoted && raw[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("Tanda kutip CSV belum ditutup");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  const header = (rows.shift() || []).map((x) =>
    x
      .trim()
      .toLowerCase()
      .replace(/^\uFEFF/, ""),
  );
  const nameIdx = header.findIndex((x) => ["nama", "name"].includes(x)),
    phoneIdx = header.findIndex((x) =>
      ["nomor", "phone", "whatsapp", "no_wa"].includes(x),
    ),
    tagIdx = header.findIndex((x) => ["label", "tags"].includes(x));
  if (nameIdx < 0 || phoneIdx < 0)
    throw new Error("Header wajib: nama,nomor,label");
  const contacts: ContactInput[] = [],
    errors: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const [i, r] of rows.entries()) {
    if (!r.some((x) => x.trim())) continue;
    try {
      const phone = normalizePhone(r[phoneIdx] || "");
      const name = (r[nameIdx] || "").trim();
      if (!name || name.length > 100)
        throw new Error("Nama wajib 1–100 karakter");
      if (seen.has(phone)) {
        duplicates++;
        continue;
      }
      seen.add(phone);
      contacts.push({
        phone,
        name,
        tags: (r[tagIdx] || "").trim().slice(0, 500),
      });
    } catch (e) {
      errors.push(
        "Baris " +
          (i + 2) +
          ": " +
          (e instanceof Error ? e.message : "Tidak valid"),
      );
    }
  }
  if (contacts.length > 1000)
    throw new Error("Maksimal 1.000 kontak per import");
  return { contacts, errors, duplicates };
}
export function validateSteps(value: unknown): CampaignStep[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2)
    throw new Error("Isi 1 atau 2 pesan");
  return value.map((s) => {
    if (
      !s ||
      !["TEXT", "IMAGE", "VIDEO"].includes(s.type) ||
      typeof s.body !== "string" ||
      (s.type !== "IMAGE" && !s.body.trim()) ||
      s.body.length > 4000
    )
      throw new Error("Teks/video membutuhkan caption atau pesan; poster boleh tanpa caption. Maksimal 4.000 karakter.");
    if (/\{\{|\}\}/.test(s.body.replaceAll("{{nama}}", "")))
      throw new Error("Variabel yang tersedia hanya {{nama}}");
    if (s.type === "IMAGE" || s.type === "VIDEO") {
      const media = String(s.media_url || "");
      const privatePath = s.type === "IMAGE"
        ? /^storage:\/\/mycontrol-campaigns\/[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$/i.test(media)
        : /^storage:\/\/mycontrol-campaigns\/[a-f0-9-]{36}\.mp4$/i.test(media);
      if (!privatePath) {
        let url: URL;
        try { url = new URL(media); }
        catch { throw new Error("Pilih berkas media atau masukkan URL HTTPS langsung yang valid"); }
        if (
          url.protocol !== "https:" ||
          url.username || url.password || url.port || !url.hostname.includes(".") ||
          /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) ||
          url.hostname.includes(":") || media.length > 2048
        ) throw new Error("Media memerlukan URL HTTPS publik");
        if (s.type === "IMAGE" && !/\.(jpe?g|png|webp)$/i.test(url.pathname)) {
          throw new Error("URL poster harus langsung ke file .jpg, .jpeg, .png, atau .webp. Link berbagi Google Drive bukan tautan gambar langsung; gunakan unggah poster.");
        }
      }
    }
    return {
      type: s.type,
      body: s.body.trim(),
      ...(s.type !== "TEXT" ? { media_url: s.media_url } : {}),
    };
  });
}
export const campaignLabels: Record<string, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Terjadwal",
  RUNNING: "Berjalan",
  PAUSED: "Dijeda",
  COMPLETED: "Selesai diproses",
  CANCELLED: "Dibatalkan",
  PENDING: "Antre",
  PROCESSING: "Diproses",
  RETRY: "Menunggu ulang",
  SENT: "Diterima gateway",
  FAILED: "Gagal",
  UNKNOWN: "Perlu rekonsiliasi",
  READ: "Dibaca",
  DELIVERED: "Sampai",
};
export async function campaignRequest(body?: unknown, query = "") {
  const r = await fetch("/api/campaigns" + query, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Permintaan gagal");
  return data;
}
