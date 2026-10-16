export type ContactInput = {
  phone: string;
  name: string;
  tags?: string;
  source?: string;
  consent?: boolean;
};
export type CampaignStep = {
  type: "TEXT" | "VIDEO";
  body: string;
  media_url?: string;
};
export function normalizePhone(value: string) {
  let phone = String(value)
    .trim()
    .replace(/[ +().-]/g, "");
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
      !["TEXT", "VIDEO"].includes(s.type) ||
      typeof s.body !== "string" ||
      !s.body.trim() ||
      s.body.length > 4000
    )
      throw new Error("Pesan harus berisi 1–4000 karakter");
    if (/\{\{|\}\}/.test(s.body.replaceAll("{{nama}}", "")))
      throw new Error("Variabel yang tersedia hanya {{nama}}");
    if (
      s.type === "VIDEO" &&
      !/^storage:\/\/mycontrol-campaigns\/[a-f0-9-]{36}\.mp4$/.test(
        s.media_url || "",
      )
    ) {
      const url = new URL(String(s.media_url || ""));
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !url.hostname.includes(".") ||
        /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
          url.hostname,
        ) ||
        url.hostname.includes(":") ||
        s.media_url.length > 2048
      )
        throw new Error("Video harus memakai URL HTTPS publik");
    }
    return {
      type: s.type,
      body: s.body.trim(),
      ...(s.type === "VIDEO" ? { media_url: s.media_url } : {}),
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
