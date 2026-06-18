import { detectDataset } from "./fileUpload";
import { parseOcrText } from "./ocrParser";
import { parseSpreadsheetFile } from "./spreadsheetParser";
import { runOcr } from "./ocr";
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
): Promise<{ rows: ExtractedRow[] } | null> {
  try {
    const imageBase64 = await fileToBase64(file);
    const mimeType = normalizeMime(file);

    const res = await fetch("/api/extract-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64, mimeType, filename: file.name }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      if (res.status === 500 && String(err?.error).includes("ANTHROPIC_API_KEY")) return null;
      console.warn("[vision] API error:", err);
      return null;
    }

    const data = await res.json();

    // Log raw Gemini output and attempts to browser console for debugging
    if (data._debug_attempts) {
      console.log("[Gemini attempts for", file.name, "]:", data._debug_attempts);
    }
    if (data._debug_rawText) {
      console.log("[Gemini raw output for", file.name, "]:\n", data._debug_rawText);
    }
    if (data.error) {
      console.error("[Gemini error for", file.name, "]:", data.error, data._debug_attempts);
    }

    const visionRows: VisionRow[] = Array.isArray(data.rows) ? data.rows : [];
    if (visionRows.length === 0) return null;

    const dataset = detectDataset(file);
    const rows: ExtractedRow[] = visionRows.map((r, order) => ({
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

    return { rows };
  } catch (err) {
    console.warn("[vision] Failed, falling back to Tesseract:", err);
    return null;
  }
}

export async function extractRowsFromFile(
  file: File,
  category: UploadCategory,
  onProgress?: (pct: number) => void
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

  // Vision (Gemini Pro) — single call, full image
  const visionResult = await extractWithVision(file, category);
  if (visionResult) return { rows: visionResult.rows };

  // Fallback: Tesseract OCR
  const ocr = await runOcr(file, onProgress);
  const dataset = detectDataset(file);
  const parsed = parseOcrText(ocr.text, category, file.name, ocr.lines).map((row) => ({
    ...row,
    dataset: row.dataset ?? dataset,
    uploadCategory: category,
  }));
  return { rows: parsed, ocrText: ocr.text };
}

export function finalizeDataset(parsedRows: ExtractedRow[]): ExtractedRow[] {
  return fillAllRows(buildAlignedDataset(parsedRows));
}
