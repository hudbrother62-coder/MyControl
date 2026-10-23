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
  const raw = String(value ?? "").trim();
  // A WAHA LID is a technical identifier, never a destination phone number.
  // Chat addresses must be resolved to a verified phone separately.
  if (/@(?:lid|c\.us|s\.whatsapp\.net)$/i.test(raw))
    throw new Error("INVALID_PHONE: ID WhatsApp/LID bukan nomor telepon untuk Blash");
  if (/@|[a-z]/i.test(raw))
    throw new Error("INVALID_PHONE: gunakan nomor telepon, bukan ID WhatsApp");
  let phone = raw.replace(/[\s+().-]/g, "");
  if (/^8\d{8,12}$/.test(phone)) phone = "62" + phone;
  else if (phone.startsWith("0")) phone = "62" + phone.slice(1);
  if (!/^[1-9][0-9]{7,14}$/.test(phone))
    throw new Error("INVALID_PHONE: nomor harus 8–15 digit internasional");
  return phone;
}

export type BlashImportContact = {
  phone: string;
  name: string;
  tags: string;
  consent: boolean;
  consent_evidence: string;
};

/**
 * Read campaign recipients from ordinary spreadsheets, including a single
 * column of phone numbers without any header or contact names.
 * Importing numbers never grants marketing permission.
 */
export function parseBlashImportRows(sourceRows: string[][]) {
  const rows = sourceRows.map(row => row.map(value => String(value ?? "").trim()));
  const first = rows.findIndex(row => row.some(Boolean));
  if (first < 0) throw new Error("File Excel/CSV kosong: tidak ada nomor untuk diimpor.");

  const header = rows[first].map(value =>
    value.toLowerCase().replace(/^\uFEFF/, "").replace(/[\s\-\/]+/g, "_"),
  );
  const find = (aliases: string[]) => header.findIndex(value => aliases.includes(value));
  let phone = find([
    "nomor", "phone", "whatsapp", "no_wa", "nomor_wa",
    "no_whatsapp", "nomor_whatsapp", "telepon", "nomor_telepon",
    "hp", "no_hp", "handphone", "ponsel", "wa",
  ]);
  const hasHeader = phone >= 0;
  let name = hasHeader ? find(["nama", "name", "nama_kontak", "nama_pelanggan"]) : -1;
  const tags = hasHeader ? find(["label", "tags", "kategori"]) : -1;
  const permission = hasHeader ? find(["izin_promosi", "consent", "izin", "persetujuan_promosi"]) : -1;
  const evidence = hasHeader ? find(["bukti_izin", "consent_evidence", "bukti_persetujuan", "sumber_izin"]) : -1;

  if (!hasHeader) {
    // Prefer whichever column actually contains telephone numbers; column A
    // is selected automatically for the common one-column, headerless layout.
    const columns = Math.min(12, Math.max(...rows.slice(first, first + 30).map(row => row.length)));
    const scores = Array.from({ length: columns }, (_, col) =>
      rows.slice(first, first + 30).filter(row => {
        try { normalizePhone(row[col] || ""); return true; }
        catch { return false; }
      }).length,
    );
    const best = Math.max(...scores);
    if (!best) throw new Error("Tidak ditemukan nomor WhatsApp. Gunakan kolom nomor, atau Excel satu kolom berisi nomor saja.");
    phone = scores.indexOf(best);
    if (phone > 0 && rows[first][0]) {
      try { normalizePhone(rows[first][0]); }
      catch { name = 0; }
    }
  }

  const contacts: BlashImportContact[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let emptyRows = 0;
  for (let i = first + (hasHeader ? 1 : 0); i < rows.length; i++) {
    const row = rows[i];
    if (!row.some(Boolean)) { emptyRows++; continue; }
    try {
      const number = normalizePhone(row[phone] || "");
      const display = (name >= 0 ? row[name] || "" : "").trim()
        || ("Pelanggan " + number.slice(-4));
      if (display.length > 100) throw new Error("Nama maksimal 100 karakter");
      if (seen.has(number)) { duplicates++; continue; }
      const rawPermission = permission >= 0 ? (row[permission] || "").toLowerCase() : "";
      if (["tidak", "no", "false", "0", "stop", "ditolak"].includes(rawPermission))
        throw new Error("Nomor sudah menolak promosi dan dilewati");
      const consent = ["ya", "yes", "true", "1", "diizinkan", "setuju"].includes(rawPermission);
      const proof = evidence >= 0 ? (row[evidence] || "").trim().slice(0, 500) : "";
      seen.add(number);
      contacts.push({
        phone: number,
        name: display,
        tags: tags >= 0 ? (row[tags] || "").slice(0, 500) : "",
        consent,
        consent_evidence: consent ? proof : "",
      });
      if (contacts.length > 1000) throw new Error("Maksimal 1.000 nomor per Blash");
    } catch (error) {
      if ((error as Error).message.includes("Maksimal 1.000")) throw error;
      errors.push("Baris " + (i + 1) + ": " + (error as Error).message);
    }
  }
  if (!contacts.length)
    throw new Error("Tidak ada nomor WhatsApp valid dalam file. " + errors.slice(0, 2).join("; "));
  return { contacts, duplicates, errors, emptyRows };
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
/** Keep the database worker's existing {{nama}} placeholder canonical. */
export function normalizePersonalizedMessage(body: string) {
  return body.replace(/\{\{nama\}\}|\{nama\}/g, "{{nama}}");
}

/** Preview exactly the same placeholder text that the outbound worker uses. */
export function renderPersonalizedMessage(body: string, name: string) {
  return normalizePersonalizedMessage(body).replaceAll("{{nama}}", name.trim() || "Bapak/Ibu");
}

export function validateSteps(value: unknown): CampaignStep[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2)
    throw new Error("Isi 1 atau 2 pesan");
  return value.map((s) => {
    const normalizedBody = typeof s?.body === "string" ? normalizePersonalizedMessage(s.body) : "";
    if (
      !s ||
      !["TEXT", "IMAGE", "VIDEO"].includes(s.type) ||
      typeof s.body !== "string" ||
      (s.type !== "IMAGE" && !s.body.trim()) ||
      normalizedBody.length > 4000
    )
      throw new Error("Teks/video membutuhkan caption atau pesan; poster boleh tanpa caption. Maksimal 4.000 karakter.");
    if (/\{\{|\}\}/.test(normalizedBody.replaceAll("{{nama}}", "")))
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
      body: normalizedBody.trim(),
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
