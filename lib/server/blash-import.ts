import { readXlsxRows } from "../xlsx-rows";
import { parseBlashImportRows } from "../campaigns";

function parseDelimitedRows(raw: string): string[][] {
  const firstLine = raw.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') {
      if (quoted && raw[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && raw[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("CSV tidak valid: tanda kutip belum ditutup.");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export async function readBlashUpload(filename: string, bytes: Uint8Array) {
  const maxBytes = 4 * 1024 * 1024;
  if (!bytes.byteLength || bytes.byteLength > maxBytes)
    throw new Error("File Excel/CSV harus terisi dan maksimal 4 MB.");
  if (/\.csv$/i.test(filename)) {
    const rows = parseDelimitedRows(new TextDecoder("utf-8").decode(bytes));
    if (rows.length > 5000) throw new Error("File terlalu panjang, maksimal 5.000 baris.");
    return { ...parseBlashImportRows(rows), sheetName: "CSV" };
  }
  if (!/\.xlsx$/i.test(filename))
    throw new Error("File harus berformat .xlsx atau .csv.");

  let issue: Error | null = null;
  for (const sheet of await readXlsxRows(bytes)) {
    try {
      return { ...parseBlashImportRows(sheet.rows), sheetName: sheet.sheetName };
    } catch (error) {
      issue = error instanceof Error ? error : new Error("Tidak ada nomor WA valid.");
    }
  }
  throw issue || new Error("Excel tidak memiliki sheet berisi nomor WhatsApp.");
}
