import JSZip from "jszip";

type SheetRows = { sheetName: string; rows: string[][] };

function xmlUnescape(value: string) {
  return value.replace(/&(?:#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, entity => {
    const key = entity.slice(1, -1).toLowerCase();
    if (key === "amp") return "&";
    if (key === "lt") return "<";
    if (key === "gt") return ">";
    if (key === "quot") return '"';
    if (key === "apos") return "'";
    try {
      if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
      if (key.startsWith("#")) return String.fromCodePoint(parseInt(key.slice(1), 10));
    } catch { /* retain malformed entity */ }
    return entity;
  });
}
function textNodes(xml: string) {
  const matches = xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/g);
  return [...matches].map(m => xmlUnescape(m[1])).join("");
}
function attribute(xml: string, name: string) {
  const found = xml.match(new RegExp("(?:^|\\s)" + name + "\\s*=\\s*([\"'])(.*?)\\1"));
  return found ? xmlUnescape(found[2]) : "";
}
function colIndex(ref: string) {
  const letters = ref.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || "";
  let col = 0;
  for (const char of letters) col = col * 26 + char.charCodeAt(0) - 64;
  return col - 1;
}

/** Read OOXML rows without requiring ExcelJS to interpret workbook styles. */
export async function readXlsxRows(data: Uint8Array): Promise<SheetRows[]> {
  if (!data.byteLength || data.byteLength > 4 * 1024 * 1024)
    throw new Error("Excel harus terisi dan maksimal 4 MB.");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); }
  catch { throw new Error("File bukan XLSX valid (isi ZIP Excel tidak dapat dibuka)."); }

  const shared: string[] = [];
  const sharedFile = zip.file("xl/sharedStrings.xml");
  if (sharedFile) {
    if ((sharedFile as any)._data?.uncompressedSize > 8 * 1024 * 1024)
      throw new Error("Daftar nama Excel terlalu besar.");
    const content = await sharedFile.async("string");
    if (content.length > 8 * 1024 * 1024) throw new Error("Daftar nama Excel terlalu besar.");
    for (const match of content.matchAll(/<(?:[A-Za-z_][\w.-]*:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si>/g))
      shared.push(textNodes(match[1]));
  }

  const allSheets = Object.keys(zip.files).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a,b) => Number(a.match(/sheet(\d+)\.xml/i)?.[1] || 0) - Number(b.match(/sheet(\d+)\.xml/i)?.[1] || 0));
  if (!allSheets.length) throw new Error("File tidak memiliki worksheet Excel.");
  const workbook = zip.file("xl/workbook.xml");
  const workbookXml = workbook ? await workbook.async("string") : "";
  const sheetNames = [...workbookXml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?sheet(?=\s)([^>]*?)\/?>/g)]
    .map(m => attribute(m[1], "name"));

  const output: SheetRows[] = [];
  for (const [index, path] of allSheets.entries()) {
    const item = zip.file(path);
    if (!item) continue;
    if ((item as any)._data?.uncompressedSize > 12 * 1024 * 1024)
      throw new Error("Sheet Excel terlalu besar.");
    const xml = await item.async("string");
    if (xml.length > 12 * 1024 * 1024) throw new Error("Sheet Excel terlalu besar.");

    const rows: string[][] = [];
    let sequentialRow = 0;
    for (const rowMatch of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?row(?=\s|>)([^>]*?)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row>/g)) {
      const rowNumber = Number(attribute(rowMatch[1], "r")) || ++sequentialRow;
      if (rowNumber < 1 || rowNumber > 5000)
        throw new Error("Excel maksimal 5.000 baris per sheet.");
      sequentialRow = Math.max(sequentialRow, rowNumber);
      const columns: string[] = [];
      let sequentialCol = 0;
      for (const cellMatch of rowMatch[2].matchAll(/<(?:[A-Za-z_][\w.-]*:)?c(?=\s|>)([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c>)/g)) {
        const ref = attribute(cellMatch[1], "r");
        const column = ref ? colIndex(ref) : sequentialCol;
        sequentialCol = Math.max(sequentialCol, column + 1);
        if (column < 0 || column >= 12) continue;
        const type = attribute(cellMatch[1], "t");
        const body = cellMatch[2] || "";
        let value = "";
        if (type === "inlineStr") value = textNodes(body);
        else {
          const raw = body.match(/<(?:[A-Za-z_][\w.-]*:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v>/)?.[1];
          if (raw !== undefined) {
            const decoded = xmlUnescape(raw);
            value = type === "s" ? (shared[Number(decoded)] || "") : decoded;
          } else value = textNodes(body);
        }
        columns[column] = value;
      }
      rows[rowNumber - 1] = columns;
    }
    output.push({sheetName: sheetNames[index] || "Sheet " + (index+1),
      rows: Array.from({length:rows.length},(_,i) => rows[i] || [])});
  }
  return output;
}
