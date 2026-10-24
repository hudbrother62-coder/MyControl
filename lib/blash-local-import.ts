"use client";

import { parseBlashImportRows } from "./campaigns";

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

  // Next.js resolves ExcelJS' browser bundle in client-side builds. Loading
  // it on demand keeps the main Blash screen lightweight.
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(
      new Uint8Array(await file.arrayBuffer()) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new Error("File Excel tidak dapat dibaca di HP. Unduh ulang file .xlsx lalu pilih filenya.");
  }

  let issue: Error | null = null;
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > 5000)
      throw new Error("Excel terlalu panjang: maksimal 5.000 baris per sheet.");
    const rows: string[][] = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      const current = sheet.getRow(r);
      const columns: string[] = [];
      for (let c = 1; c <= Math.min(current.cellCount, 12); c++) {
        const value = current.getCell(c);
        const raw = value.value;
        columns.push(
          typeof raw === "number" && Number.isSafeInteger(raw)
            ? String(raw)
            : String(value.text || raw || "").trim(),
        );
      }
      rows.push(columns);
    }
    try {
      return { ...parseBlashImportRows(rows), sheetName: sheet.name };
    } catch (error) {
      issue = error instanceof Error ? error : new Error("Tidak ada nomor WhatsApp valid.");
    }
  }
  throw issue || new Error("Excel tidak berisi nomor WhatsApp yang dapat digunakan.");
}
