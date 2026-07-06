import { detectDataset } from "./fileUpload";
import { parseSpreadsheetFile } from "./spreadsheetParser";
import { buildAlignedDataset } from "./templateBuilder";
import { fillAllRows } from "./dataGenerator";
import { emptyYearValues } from "./types";
import type { ExtractedRow, UploadCategory } from "./types";

interface VisionRow {
  segment: string;
  subSegment: string;
  subSegment1: string;
  subSegment2: string;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function normalizeMime(file: File): string {
  const t = file.type.toLowerCase();
  if (t === "image/png") return "image/png";
  if (t === "image/jpeg" || t === "image/jpg") return "image/jpeg";
  if (t === "image/webp") return "image/webp";
  if (t === "image/gif") return "image/gif";
  if (file.name.endsWith(".png")) return "image/png";
  if (file.name.endsWith(".jpg") || file.name.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}

async function extractWithVision(
  file: File,
  category: UploadCategory
): Promise<ExtractedRow[]> {
  const imageBase64 = await fileToBase64(file);
  const mimeType = normalizeMime(file);

  const res = await fetch("/api/extract-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, mimeType, filename: file.name }),
  });

  const data = await res.json().catch(() => ({ error: res.statusText }));

  if (!res.ok) {
    const msg = String(data?.error ?? res.statusText);
    throw new Error(msg.length > 120 ? msg.slice(0, 120) + "…" : msg);
  }

  if (data._debug_rawText) {
    console.log("[Claude raw output for", file.name, "]:\n", data._debug_rawText);
  }

  const visionRows: VisionRow[] = Array.isArray(data.rows) ? data.rows : [];
  if (visionRows.length === 0) {
    throw new Error("No rows extracted — check the image contains visible segment data");
  }

  const dataset = detectDataset(file);
  return visionRows.map((r, order) => ({
    region: "Global",
    segment: r.segment ?? "",
    subSegment: r.subSegment ?? "",
    subSegment1: r.subSegment1 ?? r.subSegment ?? "",
    subSegment2: r.subSegment2 ?? r.subSegment1 ?? r.subSegment ?? "",
    values: emptyYearValues(),
    source: file.name,
    order,
    dataset,
    uploadCategory: category,
  }));
}

export async function extractRowsFromFile(
  file: File,
  category: UploadCategory,
  _onProgress?: (pct: number) => void
): Promise<{ rows: ExtractedRow[]; ocrText?: string }> {
  const isSpreadsheet =
    file.name.match(/\.(xlsx|xls|csv)$/i) ||
    file.type.includes("spreadsheet") ||
    file.type.includes("excel") ||
    file.type === "text/csv";

  if (isSpreadsheet) {
    const rows = await parseSpreadsheetFile(file);
    return { rows: rows.map((row) => ({ ...row, uploadCategory: category })) };
  }

  // Image — Claude Vision only (no Tesseract fallback; it produces unusable output)
  const rows = await extractWithVision(file, category);
  return { rows };
}

export function finalizeDataset(parsedRows: ExtractedRow[]): ExtractedRow[] {
  return fillAllRows(buildAlignedDataset(parsedRows));
}
