"use client";

import { parseBlashImportRows } from "./campaigns";
import { readXlsxRows } from "./xlsx-rows";

/**
 * Browser-only fallback for Android/WhatsApp in-app browsers where a FormData
 * POST may fail before reaching the API. The same shared row parser is used
 * by the server, so deduplication, names and phone validation remain identical.
 * This function reads the selected file locally; it never uploads contacts.
 */
export async function readBlashFileLocally(file: File) {
  if (!file.size || file.size > 4 * 1024 * 1024)
    throw new Error("File Excel/CSV harus terisi dan maksimal 4 MB.");

  if (/\.csv$/i.test(file.name)) {
    const source = await file.text();
    const firstLine = source.split(/\r?\n/, 1)[0] || "";
    const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (c === '"') {
        if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
        else quoted = !quoted;
      } else if (c === delimiter && !quoted) {
        row.push(cell); cell = "";
      } else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && source[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else {
        cell += c;
      }
    }
    if (quoted) throw new Error("CSV tidak valid: tanda kutip belum ditutup.");
    if (cell || row.length) { row.push(cell); rows.push(row); }
    if (rows.length > 5000) throw new Error("File terlalu panjang, maksimal 5.000 baris.");
    return { ...parseBlashImportRows(rows), sheetName: "CSV" };
  }

  if (!/\.xlsx$/i.test(file.name))
    throw new Error("Gunakan file Excel .xlsx atau CSV, bukan ZIP atau format lain.");

  // The same XML/ZIP reader is used on the API and on Android browsers.
  // It accepts valid minimal XLSX files even when ExcelJS rejects styles.
  let problem: Error | null = null;
  for (const sheet of await readXlsxRows(new Uint8Array(await file.arrayBuffer()))) {
    try {
      return { ...parseBlashImportRows(sheet.rows), sheetName: sheet.sheetName };
    } catch (error) {
      problem = error instanceof Error ? error : new Error("Data nomor tidak valid.");
    }
  }
  throw problem || new Error("Excel tidak memiliki sheet berisi nomor WhatsApp.");
}
